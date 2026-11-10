# Servant art

Drop one image per servant here, named after the servant's `id` in `src/data/servants.js`.
The game tries `.png`, then `.jpg`, then `.webp`, and falls back to a class-colored placeholder.

| Servant | File name |
| --- | --- |
| Artoria Pendragon | `artoria.png` |
| Heracles | `heracles.png` |
| Medea | `medea.png` |
| Sasaki Kojirou | `kojirou.png` |
| EMIYA | `emiya.png` |
| Cú Chulainn | `cu.png` |
| Medusa | `medusa.png` |
| Hassan of the Cursed Arm | `hassan.png` |
| Gilgamesh | `gilgamesh.png` |
| Iskandar | `iskandar.png` |
| Hassan of the Hundred Faces | `hundred_faces.png` |
| Lancelot | `lancelot.png` |

Tips
- Portrait-oriented full art works best (e.g. Final Ascension stage art). Images are cropped with
  `object-fit: cover`, anchored near the top so faces stay in frame.
- Around 512×720 or larger keeps the command cards sharp; keep files under ~500 KB for fast loads.
- To use a different file name or a URL, set `art: '/art/whatever.webp'` on the servant.
- Official FGO art belongs to TYPE-MOON / Lasengle / Aniplex.
