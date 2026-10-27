# Migração para GitHub Pages

O fluxo ativo é: interface estática no Pages → regras e criptografia no navegador → API Git do GitHub → branch `dados-prototipo`. As ações em pages/actions usam diretamente os módulos do navegador para armazenamento, autenticação e senhas. Não há chamadas ao servidor anterior.

A base ativa é fictícia e usa uma chave nova. O acervo anterior continua nos caminhos originais, conferidos por SHA-256 em `archive/inventory.json`, fora do pacote publicado. Sua recuperação depende das chaves originais e de uma exportação dos arquivos ausentes.

Cada requisição usa uma fotografia da branch e prepara seus arquivos em memória. Uma operação bem-sucedida cria blobs, árvore e commit, avançando a referência sem força. Falhas descartam as alterações preparadas. Alterações independentes podem ser reaplicadas; alterações nos arquivos lidos ou na composição das coleções observadas retornam conflito.

A interface confirma a gravação depois da atualização da referência. Não há fila persistente de gravações offline. Exclusões removem arquivos da versão ativa; o histórico Git conserva os commits anteriores.

Actions Secrets fornece `PROTOTYPE_GITHUB_TOKEN` e `PROTOTYPE_DATA_KEY_V1` ao build. Seus valores não entram nos fontes nem nos logs, mas são publicados em `runtime-config.json` e ficam acessíveis no navegador. O risco foi aceito para o protótipo com dados fictícios. Contents read/write alcança as branches do repositório escolhido, não apenas uma pasta.

A branch principal publica a interface; a de dados é consultada pela API. Senhas usam scrypt no Worker. Sessões ficam em JSON cifrado; tokens de sessão ficam em sessionStorage ou localStorage, sem cookies HttpOnly. Recuperação de senha é administrativa.

Inicialização, backup, importação, restauração e troca do token estão no [README](../README.md). As fontes do servidor antigo, removidas da estrutura ativa, podem ser recuperadas no histórico Git pelo commit registrado no inventário.
