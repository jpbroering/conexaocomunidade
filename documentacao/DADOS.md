# Organização dos dados cifrados

Na versão Pages, estes caminhos ficam na branch dados-prototipo. Cada registro usa o SHA do blob como revisão. A chave é distribuída com o protótipo; a criptografia não garante sigilo contra os visitantes. Os formatos históricos do servidor também são descritos abaixo.

- `private-json/v1/users/`: contas; chave de arquivo derivada do nome de usuário, conteúdo criptografado, senhas com scrypt.
- `private-json/v1/sessions/`: sessões, validade e versão de autenticação.
- `private-json/v1/login-limits/`: formato histórico; a versão atual mantém o controle de tentativas na sessão do navegador.
- `private-json/v1/password-resets/`: formato histórico, não utilizado pela recuperação administrativa atual.
- `private-json/v1/clients/`: registros legados de perfil e controle de conta.
- `private-json/v1/companies/`: informações e referências às imagens de cada empresa.
- `private-json/v1/company-images/`: metadados privados das imagens, empresa responsável e decisão de aprovação.
- `private-json/v1/image-files/company-images/<empresa>/<imagem>.json`: novos arquivos de imagem de empresas; bytes criptografados com AES-GCM representados em Base64 dentro do JSON.
- `private-json/v1/about-slots/`: associação de cada espaço da aba Sobre à sua foto.
- `private-json/v1/about-assets/`: metadados das fotos do projeto.
- `private-json/v1/image-files/about-assets/about/<imagem>.json`: novos arquivos de fotos da aba Sobre em JSON criptografado.
- `private-json/v1/image-files/photos/<responsável>/<imagem>.json`: novos arquivos das rotas de foto legadas.
- `private-json/v1/reports/`: relatos privados da comunidade.
- `private-json/v1/entries/` e `ideas/`: dados das funções legadas.

As imagens são decifradas no navegador e exibidas por URLs temporárias. Os perfis demonstram os fluxos de autoria e moderação; as credenciais compartilhadas permitem acesso direto à API. Uma empresa pode excluir suas próprias fotos, inclusive aprovadas. Ela não pode aprovar fotos nem editar imagens de outras empresas. Administradores podem revisar e gerenciar imagens das empresas e da aba Sobre.

O importador local pode converter imagens binárias anteriores para JSON cifrado quando receber os arquivos e as chaves originais. A base ativa usa somente os novos envelopes JSON. O acervo inventariado permanece intacto; tabelas SQL e arquivos ausentes dependem de uma exportação futura do servidor anterior.
