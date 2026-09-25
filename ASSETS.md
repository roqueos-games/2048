# Origem dos assets

Todo arquivo em `public/` tem uma linha aqui, com a licença e a origem. O `jogo check`
reprova arquivo sem linha e licença fora da lista do SDK.

| caminho          | licença | origem                                                                                                                         |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| public/capa.jpg  | MIT     | autoral: capa ilustrada gerada pelo kit de arte do RoqueOS (`scripts/gameart`, commit `4142f768` do roqueos-front, 20/08/2026) |
| public/icone.svg | MIT     | autoral: ícone gerado pelo mesmo kit de arte, no mesmo commit                                                                  |

O som do jogo é procedural (`src/som.js`), e os ícones dos botões são SVG desenhado em
`src/Icone.vue`: nenhum dos dois é arquivo de terceiro.
