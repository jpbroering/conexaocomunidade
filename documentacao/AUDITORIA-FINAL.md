# Auditoria final do protótipo

**Data:** 27 de outubro de 2026  
**Escopo:** contas e sessões, carregamentos, gravação, pacote GitHub Pages, acervo cifrado e pequenos ajustes de interface. Esta revisão é focada e não equivale a uma certificação de segurança.

## Resultado

Não encontrei defeito bloqueante nos fluxos revisados. O ajuste visual desta entrega corrige o cabeçalho do formulário de empresa: “Editar empresa” fica à esquerda e “Voltar ao perfil” à direita em telas largas; em telas estreitas, o título vem primeiro e o botão fica abaixo, com 12 px de separação. O identificador mantém quebra de linha e espaçamento próprio.

O destino do link e os identificadores de formulário usados pelo JavaScript foram preservados. O teste de navegador agora verifica a disposição em 1280 px e 390 px, além do foco por teclado.

## Verificações executadas

| Área | Resultado |
| --- | --- |
| Testes de lógica e pacote (`npm test`) | 24 testes passaram. |
| Automação Chromium (`npm run test:browser`) | Passou: cadastro, login, sessões independentes, gravação entre contextos, imagens, mapa, recuperação, PWA, modo offline e novo layout. |
| Firefox real | Passou com dados fictícios locais: login, sessão após recarga e transição para o mapa com o indicador de carregamento. |
| Compilação (`npm run build`) | Passou; pacote do Pages gerado com a configuração local. |
| Acervo antigo (`npm run prototype:archive`) | 16 arquivos conferidos e intactos conforme os hashes do inventário. |
| Base remota (`node pages/manage.mjs check`) | Passou; branch acessível, 30 arquivos validados e decifrados com a configuração local. Revisão observada: `6315fcb38af0cba90f894fd248a3d47648566320`. |
| GitHub Actions | Publicação concluída com sucesso para o commit `52a2161d577a67c2d3889b9053aaa342680ba0dd`. |
| Site publicado | Páginas do catálogo e do mapa responderam HTTP 200. A edição publicada contém o novo cabeçalho; CSS e JavaScript usam a versão `46aad6d4f3fa`. A configuração aponta para `jpbroering/conexaocomunidade`, branch `dados-prototipo`; os valores secretos não foram exibidos. |
| Diff (`git diff --check`) | Sem erros de whitespace. |
| Configuração e credenciais | Permanecem em arquivos locais ignorados pelo Git; não fazem parte do pacote commitado. |
| Hospedagem antiga | O pacote estático não inclui a ponte antiga nem chamadas a Workers, D1 ou R2. Os dados usam a API do GitHub; o mapa consulta os tiles do OpenStreetMap. |

## Limites

- A checagem da base remota valida a revisão observada naquele momento; não substitui uma restauração periódica de backup.
- A aplicação continua sendo um protótipo com token e chave disponíveis ao navegador, conforme a arquitetura aceita para os dados fictícios. Esta auditoria não reabre essa decisão nem tenta recuperar o acervo antigo.
- Os testes cobrem os fluxos descritos acima; não representam uma revisão exaustiva de todas as telas, navegadores, dispositivos ou cenários de segurança.
