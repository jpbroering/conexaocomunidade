# Interface estática

- `pages/`: páginas HTML. A compilação as publica na raiz para preservar os links existentes.
- `assets/css/`: estilos das páginas e feedback compartilhado.
- `assets/js/`: scripts da interface. `prototype.js` e `password-worker.js` são gerados pelo build nesta pasta do pacote publicado.
- `assets/images/brand/`: fotos, fundos e marcas.
- `assets/icons/`: favicon e ícones de instalação.
- `assets/vendor/`: bibliotecas de terceiros e suas licenças.
- `manifest.webmanifest` e `sw.js`: arquivos que precisam ficar na raiz publicada para manter o escopo da PWA.

Use `npm run dev` na raiz do projeto e abra o endereço mostrado no terminal. As páginas precisam da compilação; abrir diretamente os arquivos HTML não carrega o cliente gerado nem a configuração do protótipo.

Fontes e referências das imagens ficam em `documentacao/identidade/`, fora do pacote publicado.
