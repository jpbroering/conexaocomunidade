# Conexão Comunidade · protótipo no GitHub Pages

Projeto em parceria com a FMP. A interface é publicada como site estático; o navegador lê e grava JSON cifrado pela API do GitHub na branch `dados-prototipo` do mesmo repositório.

Esta versão usa uma base fictícia nova. O acervo anterior permanece cifrado e intacto: [inventário](archive/inventory.json). Sua recuperação exige as chaves originais e, para os arquivos ausentes, uma exportação do servidor anterior.

## Preparar e executar localmente

Requisito: Node.js 22.13 ou superior. Todas as dependências ativas estão no package.json da raiz.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node pages/manage.mjs archive
npm run prototype:prepare
```

`prototype:prepare` gera uma chave nova, os arquivos cifrados iniciais e quatro contas de demonstração em `.prototype/`. A configuração fica em `.prototype/runtime-config.json`; as senhas iniciais ficam em `.prototype/credentials.txt`. Ambos são ignorados pelo Git. O comando se recusa a substituir uma preparação existente.

Preencha `token` no arquivo local de configuração usando um fine-grained personal access token limitado a este repositório, com **Contents: read/write**. Em seguida:

```sh
npm run prototype:init
npm run dev
```

A inicialização cria a branch de dados com um commit independente, sem copiar o código ou o acervo antigo. Se a branch já existir, ela é preservada e o comando é interrompido. A prévia abre em `http://127.0.0.1:5173/conexaocomunidade/`. Sem token, a compilação local funciona e a interface informa que falta configuração.

## Publicar

1. Inicialize a branch de dados pelo procedimento acima.
2. Em **Settings → Secrets and variables → Actions**, cadastre `PROTOTYPE_GITHUB_TOKEN` com o token e `PROTOTYPE_DATA_KEY_V1` com o valor `key` da configuração local. Não gere outra chave depois de inicializar a base.
3. Em **Settings → Pages**, selecione **GitHub Actions** como origem.
4. Envie as alterações à branch `main` ou execute manualmente o fluxo **Publicar protótipo no Pages**.

O fluxo verifica o acervo, executa os testes, confere a base remota e publica `dist-pages/`. O endereço deste repositório é `https://jpbroering.github.io/conexaocomunidade/`. Gravações na branch de dados ficam disponíveis pela API, sem republicar a interface.

Token e chave entram apenas no artefato publicado, sem valores reais no código-fonte ou nos logs. **Ambos são acessíveis a quem usa o site.** Isso é uma decisão do protótipo com dados fictícios. Login, perfis e limites de tentativas demonstram os fluxos; não constituem uma barreira de segurança contra quem acessa diretamente a API com as credenciais distribuídas. A permissão Contents também alcança outras branches deste repositório.

Para substituir um token expirado, atualize o segredo e a configuração local e execute novamente o fluxo. Não substitua a chave da base por esse motivo. O `runtime-config.json` nunca é guardado pelo service worker, mas a configuração já carregada fica em memória até recarregar a página.

## Dados, cópias e restauração

```sh
node pages/manage.mjs check
node pages/manage.mjs backup
node pages/manage.mjs restore SHA_COMPLETO_DO_COMMIT
```

As cópias cifradas ficam em `.prototype/backups/<commit>/`. Preserve uma cópia protegida da chave correspondente. Restaurar verifica a integridade e as referências e cria um novo commit, sem forçar a branch ou apagar seu histórico. Sessões recuperadas continuam sujeitas à expiração e à versão de autenticação.

Para importar o acervo, prepare uma pasta com os caminhos originais do armazenamento (`private-json/v1/` e, quando necessário, os binários legados). Forneça `OLD_MASTER_KEY_V1` e `OLD_DIRECTORY_KEY_V1` por ambiente local. A segunda é necessária se houver o pacote `lib/local-directory-seed.json` e nenhum levantamento já exportado como registro ativo.

```sh
node pages/manage.mjs import CAMINHO_DA_EXPORTACAO
```

O importador decifra e valida tudo antes da publicação, mantém identificadores, hashes de senha e vínculos, converte imagens antigas em JSON cifrado e usa a chave nova. Colisões de caminho cancelam toda a operação. Sessões, limites de tentativas e tokens de recuperação antigos são descartados. Uma exportação incompleta ou uma chave incorreta interrompe a importação. O material original não é alterado.

## Desenvolvimento e validação

```sh
npm test
npm run build
node pages/manage.mjs archive
```

Para conferir os fluxos em Chromium com uma API GitHub simulada, execute `npm run test:browser`. A ferramenta usa `/usr/bin/chromium` por padrão; `CHROMIUM_PATH` pode indicar outro executável compatível. O fluxo do Actions também executa essa conferência com o Chrome do runner. O teste verifica o Worker de senhas, duas sessões de navegador, upload, caminhos da subpasta, registro da PWA e página offline; a instalação em um celular precisa de conferência no aparelho.

A estrutura ativa é:

- `public/`: páginas, estilos, imagens e recursos da PWA.
- `pages/actions/`: regras de contas, empresas, relatos e administração executadas no navegador.
- `pages/`: cliente GitHub, execução das operações, Worker de senhas, build e ferramentas de dados.
- `lib/`: validações, autenticação, criptografia e armazenamento compartilhados.
- `scripts/`: prévia estática local.
- `documentacao/`: arquitetura, formatos de dados e materiais históricos do projeto.
- `archive/` e `private-json/`: inventário e acervo cifrado anterior, excluídos da publicação.
- `android/`: fontes reservadas para uma futura atualização do APK, fora da compilação atual.

O build empacota os módulos do navegador em JavaScript estático. Configurações e dependências de Next, React, Cloudflare e SQL foram retiradas. As fontes anteriores podem ser consultadas no histórico Git, a partir do commit registrado no inventário.

A base usa AES-GCM, HKDF e envelopes compatíveis com os formatos anteriores. Senhas usam scrypt-v1 em um Web Worker. Cada operação é publicada em um único commit e usa revisões para impedir sobrescritas silenciosas. A sessão dura oito horas, ou trinta dias com “manter conectado”; senha alterada ou conta desativada invalida sessões anteriores na próxima operação autenticada.

A instalação como PWA está disponível no navegador. O modo offline apresenta uma orientação e não confirma gravações. Mapas de fundo continuam sendo fornecidos pelo OpenStreetMap; rotas abrem no Google Maps. O APK anterior não é distribuído nesta versão. Recuperação de senha é feita pela administração em **Contas de teste**.

Antes de desligar a hospedagem anterior, confira os fluxos publicados em dois navegadores e no celular, teste a instalação/atualização da PWA e preserve as exportações que ainda serão necessárias. O protótipo pode funcionar sem esse servidor; o GitHub não recupera arquivos que não chegaram ao repositório.
