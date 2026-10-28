# UX, responsividade e atualização dos dados

Implementado e verificado em 28/10/2026, com base fictícia independente.

## Problemas reproduzidos e correções

- A regressão inicial excluiu uma imagem pela administração, mantendo os detalhes abertos em outra sessão. A exclusão foi confirmada, mas os detalhes continuaram com duas fotos. O teste falhou antes da correção e passou depois.
- O catálogo atualizava a lista sem atualizar os detalhes abertos. O mapa suspendia as consultas enquanto os detalhes estivessem abertos. Ambos agora consultam a base também nesse estado e atualizam o registro selecionado.
- Uma leitura de imagem malsucedida deixava a imagem transparente de referência ocupando espaço. A falha agora apresenta uma mensagem e uma ação para tentar novamente. Somente a remoção confirmada pelas referências da base retira a foto da galeria.
- Uma mudança de origem da imagem durante uma leitura podia perder a próxima tentativa. A rotina agora verifica a origem novamente ao terminar, descarta resultados antigos e libera as URLs dos elementos removidos. Fotos mantidas na galeria conservam seus elementos e URLs.
- O andamento da exclusão administrativa aparecia apenas no topo da página. A operação agora muda o texto do controle acionado, bloqueia as ações conflitantes e apresenta um aviso fixo na camada superior, inclusive com diálogo aberto. Cancelar a confirmação não inicia a operação.
- Atualizações remotas preservam filtros, rolagem, foco identificável e escolhas do guia de rota. Cadastros removidos apresentam uma mensagem no detalhe aberto. Formulários modificados mantêm os campos e oferecem carregar a versão salva mediante confirmação de descarte; revisões antigas continuam rejeitadas na gravação.
- A coordenação acompanha mudanças remotas sem substituir formulários modificados. Os dados de envio são capturados antes de desabilitar os controles. Edições em formulários diferentes do mesmo cadastro são acompanhadas separadamente.
- A conferência visual no Pages identificou que uma regra compartilhada ampliava o diálogo de detalhes em desktop. A regra foi removida, preservando os limites definidos por cada página, e o teste passou a exigir largura de até 600 px no catálogo.
- A seleção de arquivo deixou de marcar, por si só, os campos da empresa como não salvos: o upload tem sua própria confirmação remota.

## Atualização de instalações existentes da PWA

O aviso `ccUI.preserveView is not a function` foi reproduzido com a política do worker anterior: ele retirava `?v=` ao procurar o script no cache, mas buscava a página HTML nova na rede. Assim, um documento novo recebia o helper antigo. Testes em contextos limpos não reproduziam essa combinação.

A compilação agora incorpora a versão no **nome** dos scripts e estilos referenciados pelo HTML e pelo precache, por exemplo `ui-feedback.<versão>.js`. O worker já instalado não intercepta esse caminho novo. Os nomes originais continuam no artefato para referências internas e compatibilidade; o código-fonte em `public/` mantém os nomes habituais. Nenhuma credencial é incorporada a esses scripts pelo processo de versionamento.

O teste `pwa-upgrade-check.mjs` instala primeiro um worker com a política antiga e um helper sem os métodos novos. Ele demonstra que alterar somente a query ainda devolve o helper antigo; em seguida verifica catálogo e mapa com os nomes novos, mantendo aquele worker ativo. Depois aceita a atualização da PWA, confere a remoção do cache anterior e abre a página offline com seus próprios recursos. O cenário é executado em Chromium e Firefox real. Não exige limpeza manual do armazenamento nem descarta formulários para forçar ativação.

## Padrões para manutenção

Os utilitários compartilhados ficam em `public/assets/js/ui-feedback.js`, com estilos em `public/assets/css/ui-feedback.css`.

- `startOperation(controle, texto, região)` inicia o feedback e devolve a função de encerramento. Capturar `FormData` **antes** de iniciar uma operação cuja região contenha os campos: campos desabilitados não integram `FormData`. Encerrar com a mensagem e o estado real da resposta. Operações diferentes recebem identificadores para que um encerramento antigo não esconda um aviso mais recente.
- O aviso pendente permanece visível; o sucesso desaparece após cinco segundos. Erros ficam disponíveis para dispensa ou nova tentativa. Os textos locais usam o mesmo estado, evitando anúncios duplicados enquanto o aviso da operação está ativo. Mensagens de erro não deslocam automaticamente a página.
- `refreshWhileVisible(carregar, podeCarregar, opções)` consulta a cada 30 segundos, ao voltar à aba ou pela ação de atualização manual. Consultas sobrepostas, abas ocultas e gravações em andamento são evitadas. Falhas retornam `false` ou lançam erro, aumentando progressivamente a espera até cinco minutos. Consultas auxiliares podem usar `{showStatus:false}`.
- A API do GitHub pode acrescentar tempo de resposta ao intervalo. Ao receber limite de uso, a camada de dados respeita `Retry-After` e a data de reinício informada antes de fazer outras requisições, inclusive manuais. A interface informa a falha e mantém o último conteúdo carregado.
- `preserveView(atualizar)` protege posições de rolagem e foco nos elementos identificados. `syncGallery` concilia imagens pelo identificador, preservando as que continuam disponíveis e exibindo um estado vazio compacto quando não resta nenhuma.
- Identificação de aprovação usa texto e cor. Termos exibidos ao usuário incluem Galeria, Logo e Fachada. A ação que repetiria o estado atual não é exibida.
- Os estilos compartilhados permitem quebra de textos e grupos de ações, limitam controles à largura disponível, mantêm foco visível e alvos principais com pelo menos 44 px. Diálogos consideram a altura disponível; o fechamento permanece acessível. A animação respeita a preferência por movimento reduzido.

A revisão preservou os endpoints, os envelopes cifrados, os perfis e os endereços publicados. Não há migração de dados nesta entrega.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test` | 25 testes passaram: leitura de requisições, fluxos e persistência, concorrência, falhas, espera após limite da API, agendamento da atualização e verificações estáticas. |
| `npm run test:browser` | Passou: bateria existente, regressões administrativas e atualização de uma PWA antiga em Chromium. |
| `npm run test:browser:firefox` | Passou no Firefox real instalado, via suporte BiDi do Playwright, incluindo atualização com cache antigo. |
| `npm run build` | Pacote estático gerado com sucesso. |
| `npm run prototype:archive` | 16 arquivos originais conferidos e intactos. |
| `git diff --check` | Sem erros de formatação. |

As regressões de navegador cobrem login, cancelamento da exclusão sem gravação, andamento visível sem voltar ao topo, exclusão entre sessões independentes, última foto, detalhes do mapa abertos, preservação da URL da foto restante e do transporte escolhido, falha transitória com nova tentativa, troca da origem durante leitura atrasada, aprovação/rejeição, substituição, fachada/logo, conflito sem perda dos campos, aviso acima de diálogo e salvamento pela coordenação.

Os testes anteriores também verificam falhas de rede, token inválido, limite da API, arquivo cifrado inválido, commits atômicos de imagens, preservação do acervo e restauração. A bateria geral do navegador mantém a verificação de recursos offline e dos caminhos em subpasta.

Foram geradas capturas e conferidas as dimensões de 12 telas funcionais em 360, 390, 768 e 1280 px; a janela de 1280 px usa altura de 600 px. Não houve transbordamento horizontal da página nesses cenários. Capturas representativas de administração, cadastro, coordenação e mapa foram inspecionadas visualmente. Evidências locais ficam em `.prototype/ux/chromium/` e `.prototype/ux/firefox/`, ignoradas pelo Git.

## Limitações e publicação

- Os testes usam dados fictícios e API do GitHub simulada. Nenhum teste de escrita foi executado na base publicada.
- No Firefox, o servidor local preserva os corpos dos pedidos porque a interceptação BiDi dessa versão do Playwright não os fornece. A atualização entre telas é provocada pelo retorno à aba; o intervalo de 30 segundos é verificado com relógio controlado no Chromium e no teste do agendador.
- O teste de ampliação usa zoom CSS de 200% na coordenação. Não representa uma conferência manual de zoom nativo de todas as telas nem um teste em aparelho físico.
- Os serviços externos de mapas são bloqueados nas regressões. A atualização dos registros e dos detalhes é verificada; a disponibilidade das imagens dos mapas e do GPS real depende de conferência no ambiente publicado.
- Não foi feita certificação de acessibilidade ou revisão exaustiva de todos os estados visuais. Os fluxos de recuperação dos cifrados antigos continuam dependentes das chaves e exportações já documentadas.
- Os commits foram enviados por HTTPS, usando a autenticação Git já disponível. O envio por SSH continuou indisponível. A conferência final da publicação é registrada após o deploy da correção de atualização da PWA.

Foi aplicada a skill simplify aos trechos alterados, separando a construção dos cartões da coordenação e a identificação do foco, além de substituir expressões condensadas por controle de fluxo direto. As baterias finais foram executadas após a simplificação.
