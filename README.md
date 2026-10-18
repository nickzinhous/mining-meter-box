# Pandora

Protótipo em teste para o lançamento de testemunho de sondagem.

Hoje a empresa de sondagem monta o boletim à mão. Quando o furo chega, o metro a metro é feito de novo, também à mão. No Pandora os dois saem dos mesmos intervalos: avanço, recuperação e a posição na caixa.

## O que o teste cobre

- Cadastro do furo e dos intervalos, com avanço e recuperação.
- A caixa é desenhada da base para cima. O zero de cada canaleta fica embaixo. Cada caixa tem três canaletas de 1 m.
- A recuperação ocupa a caixa. Ela não pode passar do avanço. Recuperação zero ainda marca o taquinho, um friso à frente, sem abrir um vão do tamanho do avanço.
- A marcação de metro a metro aparece sozinha na borda da canaleta, do metro 1 até a profundidade final.
- O boletim impresso segue a folha de sondagem diamantada. Intervalo, avanço, recuperação e percentual saem do lançamento. Data, sonda, consumo, checklist e equipe ficam em branco para a mão. Gerar o boletim não altera os intervalos.
- O furo pode ir para outro computador em arquivo JSON. A tabela CSV abre no Excel.

## O que o teste não cobre

- Os furos ficam no navegador em que foram lançados. Não há servidor nem uso simultâneo por várias pessoas.
- O acesso também fica só nesse navegador. Não substitui o controle de usuário da empresa.
- As fotografias não entram no arquivo do furo. Elas continuam no navegador em que foram tiradas.
- O boletim não inventa cliente, data, local, sonda, responsável nem consumo. O que o lançamento não tem fica em branco.

## Como passar o furo

1. Quem faz a sondagem lança os intervalos e confere a caixa.
2. Em Ações, usa Baixar furo. O boletim, se precisar do documento, sai em Gerar boletim técnico.
3. Quem recebe o arquivo usa Abrir arquivo, na tela de sondagens ou em Ações. A caixa e o metro a metro são recalculados. Não é preciso marcar de novo.

## Como abrir

Sirva a pasta e abra o endereço mostrado:

```bash
npx --yes serve .
```

Ou use `serve.ps1` no Windows. O acesso de teste é criado neste navegador na primeira entrada.

## Como conferir as regras

```bash
node check.js
```

O script confere a orientação da caixa, o limite da recuperação, a marca metro a metro, a manobra sem testemunho e o boletim sem dados inventados.
