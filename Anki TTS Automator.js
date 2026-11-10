const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");
require("dotenv").config();

const API_KEY = process.env.MISTRAL_API_KEY;

const MODEL_ID = "voxtral-mini-tts-2603";
const VOICE_ID = "c69964a6-ab8b-4f8a-9465-ec0925096ec8";
const URL = "https://api.mistral.ai/v1/audio/speech";

const ESPERA_ENTRE_FRASES = 500;
const QUANTIDADE_CAMPOS = 5;
const SUFIXO_MINING = "_Mining";

let totalGerados = 0;
let totalExistentes = 0;
let totalFalhas = 0;

const errosDetalhados = [];

// Guarda o texto associado a cada arquivo desta execução para detectar
// dois cartões pedindo o mesmo nome com textos diferentes.
const textoPorArquivo = new Map();

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function registrarErro(tipo, linha, texto, motivo) {
    totalFalhas++;

    errosDetalhados.push({
        tipo,
        linha,
        texto,
        motivo
    });
}

// Divide uma linha TSV respeitando campos entre aspas.
// Aceita aspas escapadas como "" (formato da exportação do Anki).
function separarCamposTSV(linha) {
    const campos = [];
    let campo = "";
    let dentroDeAspas = false;

    for (let i = 0; i < linha.length; i++) {
        const caractere = linha[i];

        if (caractere === '"') {
            if (dentroDeAspas && linha[i + 1] === '"') {
                campo += '"';
                i++;
            } else {
                dentroDeAspas = !dentroDeAspas;
            }
        } else if (caractere === "\t" && !dentroDeAspas) {
            campos.push(campo);
            campo = "";
        } else {
            campo += caractere;
        }
    }

    if (dentroDeAspas) {
        return {
            erro: "Há aspas não fechadas em um dos campos."
        };
    }

    campos.push(campo);

    return { campos };
}

// Remove tags HTML e normaliza espaços para obter o texto que será falado.
function textoSemHTML(html) {
    return html
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
}

// Extrai o nome do arquivo de um campo no formato [sound:Nome.mp3].
function extrairNomeSom(campo) {
    const m = campo.trim().match(/^\[sound:(.+\.mp3)\]$/i);

    if (!m) {
        return {
            erro: "O campo deve estar no formato [sound:Nome.mp3]."
        };
    }

    const nome = m[1].trim();

    if (/[<>:"/\\|?*\x00-\x1F]/.test(nome)) {
        return {
            erro: `O nome "${nome}" contém caracteres proibidos em nomes de arquivo (< > : " / \\ | ? *).`
        };
    }

    if (/^[. ]|[. ]$/.test(nome.replace(/\.mp3$/i, ""))) {
        return {
            erro: `O nome "${nome}" começa ou termina com ponto ou espaço.`
        };
    }

    return { nome };
}

// Solicita a pasta que contém os arquivos TXT.
async function escolherPasta(rl) {
    while (true) {
        let pasta = await rl.question(
            "\nDigite ou cole o caminho da pasta que contém os TXT:\n> "
        );

        pasta = pasta.trim().replace(/^["']|["']$/g, "");

        if (!fs.existsSync(pasta)) {
            console.log("Pasta não encontrada. Tente novamente.");
            continue;
        }

        if (!fs.statSync(pasta).isDirectory()) {
            console.log("O caminho informado não é uma pasta.");
            continue;
        }

        return path.resolve(pasta);
    }
}

// Lista os TXT e permite selecionar somente um.
async function escolherArquivo(rl, pasta) {
    const arquivosTXT = fs.readdirSync(pasta)
        .filter(arquivo =>
            arquivo.toLowerCase().endsWith(".txt") &&
            !arquivo.toLowerCase().includes("_shadowing") &&
            fs.statSync(path.join(pasta, arquivo)).isFile()
        )
        .sort((a, b) =>
            a.localeCompare(b, undefined, {
                numeric: true,
                sensitivity: "base"
            })
        );

    if (arquivosTXT.length === 0) {
        console.log("\nNenhum arquivo TXT válido encontrado nessa pasta.");
        return null;
    }

    console.log("\n========== ARQUIVOS TXT ==========");

    arquivosTXT.forEach((arquivo, indice) => {
        console.log(`${indice + 1}. ${arquivo}`);
    });

    console.log("==================================");

    while (true) {
        const resposta = await rl.question(
            "\nDigite o número do TXT que deseja processar (ou 0 para cancelar): "
        );

        const numero = Number(resposta);

        if (
            resposta.trim() !== "" &&
            Number.isInteger(numero) &&
            numero >= 0 &&
            numero <= arquivosTXT.length
        ) {
            if (numero === 0) {
                console.log("Operação cancelada.");
                return null;
            }

            return path.join(pasta, arquivosTXT[numero - 1]);
        }

        console.log("Opção inválida. Digite um número da lista.");
    }
}

// Gera o áudio usando a API da Mistral.
async function gerarAudio(texto, caminhoSaida, contexto) {
    try {
        const resposta = await fetch(URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: MODEL_ID,
                input: texto,
                voice_id: VOICE_ID,
                response_format: "mp3"
            })
        });

        if (!resposta.ok) {
            const erro = await resposta.text();
            throw new Error(`HTTP ${resposta.status}: ${erro}`);
        }

        const tipoConteudo = resposta.headers.get("content-type") || "";
        let audioBuffer;

        if (tipoConteudo.includes("application/json")) {
            const dados = await resposta.json();

            if (!dados.audio_data) {
                throw new Error("A resposta da API não contém audio_data.");
            }

            audioBuffer = Buffer.from(dados.audio_data, "base64");
        } else {
            const audioArrayBuffer = await resposta.arrayBuffer();
            audioBuffer = Buffer.from(audioArrayBuffer);
        }

        if (audioBuffer.length === 0) {
            throw new Error("A API retornou um áudio vazio.");
        }

        fs.writeFileSync(caminhoSaida, audioBuffer);

        console.log(`  Gerado: ${path.basename(caminhoSaida)}`);
        totalGerados++;
        return true;

    } catch (erro) {
        console.error(`  Erro ao gerar áudio: ${erro.message}`);

        registrarErro(
            contexto.tipo,
            contexto.linha,
            texto,
            `${erro.message} | Arquivo: ${caminhoSaida}`
        );

        return false;
    }
}

// Gera o áudio com o NOME EXATO informado no cartão, se ainda não existir.
async function gerarAudioSeNecessario(
    texto,
    nomeMP3,
    pastaSaida,
    contexto
) {
    const caminhoMP3 = path.join(pastaSaida, nomeMP3);

    // Mesmo nome pedido com textos diferentes na mesma execução.
    const anterior = textoPorArquivo.get(caminhoMP3.toLowerCase());

    if (anterior !== undefined && anterior !== texto) {
        const motivo =
            `O nome "${nomeMP3}" já foi usado para o texto "${anterior}", ` +
            `mas aqui o texto é "${texto}". Use nomes diferentes nos cartões.`;

        console.error(`  Erro: ${motivo}`);

        registrarErro(contexto.tipo, contexto.linha, texto, motivo);
        return;
    }

    textoPorArquivo.set(caminhoMP3.toLowerCase(), texto);

    if (fs.existsSync(caminhoMP3)) {
        console.log(`  Já existe: ${nomeMP3}`);
        totalExistentes++;
        return;
    }

    await gerarAudio(texto, caminhoMP3, contexto);
    await esperar(ESPERA_ENTRE_FRASES);
}

// Lê os cinco campos de um cartão já pronto e devolve o que o programa precisa.
// Campos: Sentence, translation, audio, word, word_audio.
function interpretarCartao(campos) {
    const frase = textoSemHTML(campos[0]);
    const palavra = textoSemHTML(campos[3]);

    if (!frase) {
        return { erro: "O campo Sentence está vazio." };
    }

    if (!palavra) {
        return { erro: "O campo word está vazio." };
    }

    const somFrase = extrairNomeSom(campos[2]);

    if (somFrase.erro) {
        return { erro: `Campo audio (3): ${somFrase.erro}` };
    }

    const somPalavra = extrairNomeSom(campos[4]);

    if (somPalavra.erro) {
        return { erro: `Campo word_audio (5): ${somPalavra.erro}` };
    }

    if (!somPalavra.nome.toLowerCase().endsWith(`${SUFIXO_MINING.toLowerCase()}.mp3`)) {
        return {
            erro: `Campo word_audio (5): o nome "${somPalavra.nome}" deve terminar com ${SUFIXO_MINING}.mp3.`
        };
    }

    if (somFrase.nome.toLowerCase().endsWith(`${SUFIXO_MINING.toLowerCase()}.mp3`)) {
        return {
            erro: `Campo audio (3): o nome "${somFrase.nome}" não pode terminar com ${SUFIXO_MINING}.mp3, que é reservado para o áudio da palavra.`
        };
    }

    return {
        frase,
        palavra,
        nomeFrase: somFrase.nome,
        nomePalavra: somPalavra.nome
    };
}

async function processarArquivo(caminhoTXT) {
    const nomeArquivo = path.basename(
        caminhoTXT,
        path.extname(caminhoTXT)
    );

    const pastaArquivo = path.join(
        path.dirname(caminhoTXT),
        nomeArquivo
    );

    const pastaFrases = path.join(pastaArquivo, "Frases");
    const pastaMining = path.join(pastaArquivo, "Mining");

    fs.mkdirSync(pastaFrases, { recursive: true });
    fs.mkdirSync(pastaMining, { recursive: true });

    console.log(`\nProcessando: ${path.basename(caminhoTXT)}`);
    console.log(`Áudios das frases: ${pastaFrases}`);
    console.log(`Áudios das expressões: ${pastaMining}`);

    const conteudo = fs.readFileSync(caminhoTXT, "utf8").replace(/^﻿/, "");
    const linhas = conteudo.split(/\r?\n/);

    let linhasValidas = 0;

    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];

        if (!linha.trim()) {
            continue;
        }

        const numeroLinha = i + 1;
        const resultadoTSV = separarCamposTSV(linha);

        if (resultadoTSV.erro) {
            console.error(`\n  Erro na linha ${numeroLinha}: ${resultadoTSV.erro}`);

            registrarErro(
                "Validação da linha TSV",
                numeroLinha,
                linha,
                resultadoTSV.erro
            );

            continue;
        }

        const campos = resultadoTSV.campos;

        if (campos.length !== QUANTIDADE_CAMPOS) {
            const motivo =
                `A linha deve conter exatamente ${QUANTIDADE_CAMPOS} campos separados por TAB. Foram encontrados ${campos.length}.`;

            console.error(`\n  Erro na linha ${numeroLinha}: ${motivo}`);

            registrarErro(
                "Validação da linha TSV",
                numeroLinha,
                linha,
                motivo
            );

            continue;
        }

        const cartao = interpretarCartao(campos);

        if (cartao.erro) {
            console.error(`\n  Erro na linha ${numeroLinha}: ${cartao.erro}`);

            registrarErro(
                "Validação do cartão",
                numeroLinha,
                linha,
                cartao.erro
            );

            continue;
        }

        const { frase, palavra, nomeFrase, nomePalavra } = cartao;
        linhasValidas++;

        console.log(`\n[ Linha ${numeroLinha} ]`);
        console.log(`  Frase: ${frase}`);
        console.log(`  Arquivo da frase: ${nomeFrase}`);
        console.log(`  Palavra: ${palavra}`);
        console.log(`  Arquivo da palavra: ${nomePalavra}`);

        // 1. Áudio da frase completa, com o nome do campo audio.
        await gerarAudioSeNecessario(
            frase,
            nomeFrase,
            pastaFrases,
            {
                tipo: "Áudio da frase completa",
                linha: numeroLinha
            }
        );

        // 2. Áudio isolado da palavra, com o nome do campo word_audio.
        await gerarAudioSeNecessario(
            palavra,
            nomePalavra,
            pastaMining,
            {
                tipo: "Áudio da expressão (Mining)",
                linha: numeroLinha
            }
        );
    }

    if (linhasValidas === 0) {
        console.log(
            "\nNenhuma linha válida encontrada para gerar os áudios."
        );
    } else {
        console.log(`\nLinhas válidas processadas: ${linhasValidas}`);
    }
}

// Mostra o resumo e os detalhes de todos os erros encontrados.
function mostrarResumo() {
    console.log("\n========== RESUMO FINAL ==========");
    console.log(`Áudios gerados: ${totalGerados}`);
    console.log(`Áudios que já existiam: ${totalExistentes}`);
    console.log(`Total de erros: ${totalFalhas}`);

    if (errosDetalhados.length > 0) {
        console.log("\n========== DETALHES DOS ERROS ==========");

        errosDetalhados.forEach((erro, indice) => {
            console.log(`\nErro ${indice + 1}`);
            console.log(`Tipo: ${erro.tipo}`);
            console.log(`Linha do TXT: ${erro.linha}`);
            console.log(`Texto: ${erro.texto}`);
            console.log(`Motivo: ${erro.motivo}`);
        });

        console.log("\n========================================");
    } else {
        console.log("\nNenhum erro encontrado!");
    }

    console.log("\n==================================");
}

async function main() {
    const rl = readline.createInterface({ input: stdin, output: stdout });

    try {
        if (!API_KEY) {
            const mensagem =
                "MISTRAL_API_KEY não encontrada. Verifique o arquivo .env.";

            console.error(`ERRO: ${mensagem}`);

            registrarErro(
                "Configuração",
                "-",
                "-",
                mensagem
            );

            process.exitCode = 1;
            return;
        }

        console.log("==================================");
        console.log("     GERADOR DE ÁUDIOS MISTRAL");
        console.log("==================================");

        const pastaOrigem = await escolherPasta(rl);
        const caminhoTXT = await escolherArquivo(rl, pastaOrigem);

        if (!caminhoTXT) {
            return;
        }

        const confirmar = await rl.question(
            `\nDeseja gerar os áudios de "${path.basename(caminhoTXT)}"? (s/n): `
        );

        if (!["s", "sim"].includes(confirmar.trim().toLowerCase())) {
            console.log("Operação cancelada.");
            return;
        }

        await processarArquivo(caminhoTXT);

    } catch (erro) {
        console.error(
            "\nErro inesperado durante o processamento:",
            erro.message
        );

        registrarErro(
            "Erro inesperado",
            "-",
            "-",
            erro.stack || erro.message
        );

        process.exitCode = 1;

    } finally {
        mostrarResumo();
        rl.close();
    }
}

if (require.main === module) {
    main().catch(erro => {
        console.error("Erro fatal:", erro);
        process.exitCode = 1;
    });
}

module.exports = { separarCamposTSV, interpretarCartao, textoSemHTML };
