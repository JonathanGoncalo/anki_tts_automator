# Gerador de áudios para o Anki

Script em Node.js que lê um arquivo TXT exportado do Anki e gera, em lote, os áudios de cada card usando a API de texto para voz da Mistral. Para cada card, ele cria dois MP3: o da frase completa e o da palavra isolada.

## Como funciona

1. Você escolhe a pasta e o arquivo TXT que quer processar.
2. O script valida cada linha (quantidade de campos, formato dos nomes de áudio e nomes repetidos).
3. Para cada card válido, gera o áudio da frase e o da palavra pela API da Mistral.
4. Os arquivos são salvos com o nome exato que está no card, em duas pastas: `Frases` e `Mining`.
5. No final, mostra um resumo com o total de áudios gerados, os que já existiam e todos os erros, linha por linha.

Áudios que já existem não são gerados de novo, então dá para rodar o script outra vez no mesmo arquivo sem refazer o que já deu certo.

## Formato do TXT

Cada linha do arquivo deve ter exatamente **5 campos separados por TAB**:

| # | Campo        | Conteúdo                                                     |
|---|--------------|--------------------------------------------------------------|
| 1 | Sentence     | Frase que será falada                                        |
| 2 | translation  | Tradução (não é usada para gerar áudio)                      |
| 3 | audio        | `[sound:NomeDaFrase.mp3]`                                    |
| 4 | word         | Palavra ou expressão que será falada                         |
| 5 | word_audio   | `[sound:NomeDaPalavra_Mining.mp3]`                           |

Regras dos nomes de áudio:

- O nome do arquivo gerado é exatamente o que está dentro de `[sound:...]`. Por isso ele precisa bater com o card para o Anki reconhecer o áudio.
- O áudio da palavra (campo 5) deve terminar com `_Mining.mp3`. O da frase (campo 3) não pode terminar assim.
- Não são aceitos os caracteres `< > : " / \ | ? *`, nem nomes que começam ou terminam com ponto ou espaço.
- Dois cards não podem usar o mesmo nome de arquivo para textos diferentes.
- Arquivos TXT com `_shadowing` no nome são ignorados na lista.

## Requisitos

- Node.js 18 ou superior
- Uma chave de API da Mistral

## Instalação

```bash
git clone https://github.com/JonathanGoncalo/NOME-DO-REPOSITORIO.git
cd NOME-DO-REPOSITORIO
npm install
```

Crie um arquivo `.env` na raiz do projeto, copiando o `.env.example`, e coloque a sua chave:

```
MISTRAL_API_KEY=sua_chave_aqui
```

O `.env` fica só no seu computador e não é enviado ao GitHub.

## Uso

```bash
node gerador-de-audios.js
```

O programa pede o caminho da pasta com os TXT, mostra a lista de arquivos, e você escolhe o número e confirma. Os áudios são criados em uma pasta com o nome do TXT:

```
nome-do-arquivo/
├── Frases/   (áudios das frases completas)
└── Mining/   (áudios das palavras)
```

Depois, copie os MP3 para a pasta de mídia do Anki (`collection.media`) para que os cards encontrem os áudios.

## Configurações no código

No início do arquivo `gerador-de-audios.js` ficam as constantes que você pode ajustar:

- `MODEL_ID` e `VOICE_ID`: modelo e voz usados na geração.
- `ESPERA_ENTRE_FRASES`: pausa, em milissegundos, entre as chamadas à API.
- `SUFIXO_MINING`: sufixo que identifica o áudio da palavra.

## Autor

Jonathan Gonçalo
[LinkedIn](https://www.linkedin.com/in/jonathangoncalo) | [GitHub](https://github.com/JonathanGoncalo)