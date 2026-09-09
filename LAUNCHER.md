# DOODLE OPS Launcher

Kontrol layar sentuh dan sistem mod sisi-klien untuk [DOODLE OPS](https://github.com/osnailcyargta-ctrl/fps).

**Buka: `https://bantall.github.io/doodle-ops/launcher/`**

Game aslinya tetap ada di `https://bantall.github.io/doodle-ops/` dan sama persis dengan upstream.

---

## Aturan utama: tidak satu pun file game disentuh

Semua yang ditambahkan fork ini adalah file **baru**:

```
sw.js                                   service worker: pengganti file untuk mod
launcher/                               launcher dan runtime mod
mods/mobile-controls/                   mod kontrol sentuh (mod biasa, ikut repo)
.github/workflows/sync-upstream.yml     sinkron otomatis dengan upstream
LAUNCHER.md                             berkas ini
```

`index.html`, `styles.css`, dan seluruh `src/` tidak diubah sama sekali. Itulah yang
membuat `git merge upstream/main` selalu bersih: upstream boleh menulis ulang seluruh
gamenya dan tidak akan pernah bertabrakan dengan file di atas.

Service worker menyuntikkan satu baris ke halaman game **saat dimuat** — runtime mod —
bukan menulisnya ke `index.html`. Sisanya dibawa masing-masing mod.

---

## Kontrol sentuh

Kontrol sentuh **bukan bagian dari launcher**. Ia mod utuh di `mods/mobile-controls/`
dengan `mod.json`-nya sendiri. Saat launcher pertama dibuka, ia mengezip folder itu di
memori lalu memasangnya lewat `installMod()` yang **sama persis** dengan jalur yang
dipakai zip buatanmu. Setelah itu ia hanya baris biasa di database.

Yang launcher tahu tentangnya cuma satu hal: folder mana yang berisi mod bawaan
(`launcher/js/bundled.js`, satu baris array). Nama, versi, daftar file, dan skripnya
semua dibaca dari `mod.json` milik mod itu. Tidak ada satu pun cabang kode
"kalau ini mod bawaan" di runtime, di service worker, atau di UI.

Konsekuensinya ia benar-benar setara dengan mod lain: bisa dimatikan, diurutkan,
**ditimpa** mod lain, dan **dihapus**. Menghapusnya permanen sampai kamu menekan
`PULIHKAN MOD BAWAAN` di layar MOD. Matikan, dan game kembali persis seperti upstream:
WASD, mouse look, pointer lock, tanpa sisa patch apa pun — termasuk stylesheet-nya,
karena mod itu yang memasang dan mencabut `touch.css`-nya sendiri.

Pengaturannya ada **di dalam game** — tombol `KONTROL SENTUH` di layar awal dan di menu
jeda. Panelnya punya tombol `‹ KEMBALI` di atas, tombol `SELESAI` di bawah, tutup lewat
Escape, dan tutup kalau kamu menekan area gelap di luar panel. Tombol itu dibuat oleh
mod tersebut, jadi ia ikut hilang begitu modnya dimatikan.

| Kontrol | Fungsi |
|---|---|
| Joystick kiri | jalan (8 arah, dengan histeresis supaya diagonal tidak berkedip) |
| Geser layar kosong | putar kamera |
| Ketuk layar kosong | tembak / tebas |
| `FIRE` | tahan untuk tembak terus |
| `SCOPE` | tahan untuk scope (setara klik kanan); lepas = batal |
| `SCOPE` + ketuk layar | tembak sambil scope |
| `Q` | skill doodler, menyala saat siap |
| `KNIFE` / `GUN` / `SWAP` | ganti senjata |
| `JUMP` `RELOAD` `PICK` | lompat, isi ulang, ambil senjata |
| `SCORE` | tahan untuk papan skor |
| `MENU` | jeda |

### Ketuk vs tahan

Sebuah sentuhan di layar kosong dihitung **ketuk** kalau lepas dalam `tapMaxMs`
(bawaan 220 ms) *dan* jarinya bergerak kurang dari `tapMaxMove` (bawaan 16 px). Lebih
lama atau lebih jauh dari itu, ia dianggap **tahan** dan hanya menggerakkan kamera.
Keduanya bisa diatur dari panel di dalam game.

### Multitouch

Setiap kontrol memakai Pointer Events dengan `setPointerCapture`, dan setiap elemen
memasang `touch-action: none`. Itu yang menghilangkan bug klasik "tombol A ditahan,
tombol B jadi mati": tiap jari punya `pointerId` dan elemennya sendiri sepanjang
hidupnya, dan browser tidak pernah merebut salah satunya untuk scroll atau pinch-zoom.

Jari pertama di layar kosong yang menyetir kamera; jari tambahan tetap bisa mengetuk
untuk menembak. Itu sebabnya "tahan SCOPE lalu ketuk layar" bekerja.

### Kenapa tombolnya tidak muncul di browser desktop

Bawaannya `otomatis`, yang hanya menyalakan tombol kalau ada layar sentuh. Di browser
desktop tidak ada yang bisa dideteksi. Buka `KONTROL SENTUH` di dalam game dan setel ke
`selalu nyala` — berlaku langsung, tanpa memuat ulang.

---

## Mod

### Cara kerjanya

Service worker memotong setiap permintaan file di bawah scope repo. Kalau ada mod aktif
yang membawa file di path itu, isinya dilayani dari IndexedDB. Tidak ada daftar file
yang boleh dimod di mana pun dalam kode ini — **path apa pun yang kamu taruh di zip,
itulah yang dipakai.**

File asli di repo tidak pernah berubah. Semua mod hanya hidup di browser perangkat itu.

### Mengganti *dan* menambah

Mod tidak terbatas menimpa file yang sudah ada. Path yang belum ada di repo tetap
dilayani, jadi mod boleh membawa modul JS baru, tekstur baru, audio baru, atau data apa
pun, lalu memanggilnya dari skripnya sendiri atau dari file yang ia ganti. Di daftar
file tiap mod, yang menambah ditandai `baru` dan yang menimpa ditandai `ganti`.

### Format

```
mod-saya.zip
├── mod.json
├── src/player.js              ← menimpa file game
├── src/senjata-baru.js        ← file baru, dipanggil dari player.js di atas
├── styles.css
├── assets/audio/pistol-shot.mp3
└── mods/saya/init.js          ← skrip entri
```

```json
{
  "name": "Mod Saya",
  "version": "1.0.0",
  "author": "kamu",
  "description": "Apa yang mod ini lakukan.",
  "scripts": ["mods/saya/init.js"]
}
```

Kalau semua isinya dibungkus satu folder (kebiasaan saat mengezip folder), lapisan itu
dilepas otomatis. `__MACOSX/` dan `.DS_Store` dibuang.

Satu-satunya yang **tidak boleh** diganti: `sw.js` dan `launcher/`. Kalau sebuah mod
bisa mengganti manajer modnya sendiri, satu mod rusak akan mengunci kamu tanpa jalan
kembali. `mods/` tidak dilindungi — jadi mod buatanmu boleh menimpa
`mods/mobile-controls/touch.js` kalau kamu mau layout tombol sendiri.

### Skrip entri

File yang disebut di `scripts` dijalankan sebagai modul setelah game siap, dengan
`window.__game` dan `window.DoodleMods` tersedia. Ini cara termurah untuk tweak kecil —
tidak perlu menyalin seluruh file hanya untuk mengubah satu angka.

```js
const M = window.DoodleMods;

M.onReady((game) => {
  game.player.maxHealth = 150;

  // Bungkus method yang ada, tanpa menyalin filenya.
  const unwrap = M.wrap(game.player, 'useSkill', (original) => function (...args) {
    const used = original.apply(this, args);
    if (used) game.toast('SKILL!');
    return used;
  });

  // Dipanggil kalau mod ini dimatikan saat game jalan.
  M.onTeardown('mod-saya', unwrap);
});
```

| API | Fungsi |
|---|---|
| `M.game` | objek game |
| `M.onReady(cb)` | jalan begitu game ada |
| `M.onFrame(cb)` | tiap frame, `(game, dt)` |
| `M.wrap(obj, name, factory)` | bungkus sebuah method, mengembalikan fungsi pembatal |
| `M.onTeardown(id, fn)` | cara membatalkan mod ini saat dimatikan |
| `M.asset(path)` | `fetch` file yang dibawa mod ini |
| `M.log(...)` | log bertanda |

### Urutan dan konflik

Urutan di daftar MOD adalah prioritas: kalau dua mod aktif menyentuh file yang sama,
**yang paling bawah menang**. Baris yang kalah ditandai merah di daftar file.

### Penyimpanan

Mod disimpan di **IndexedDB**, bukan localStorage. localStorage mentok di sekitar 5 MB
*string*, dan satu mod yang mengganti tekstur atau mp3 langsung melewatinya. IndexedDB
menyimpan byte sebagai byte, praktis tanpa batas, dan bisa dibaca dari service worker —
yang localStorage tidak bisa. Preferensi kontrol sentuh yang kecil tetap di localStorage.

---

## Sinkron dengan upstream

`.github/workflows/sync-upstream.yml` berjalan tiap hari (dan bisa dijalankan manual dari
tab Actions). Ia menarik `osnailcyargta-ctrl/fps`, menggabungkannya, mendorong hasilnya,
lalu memicu ulang deploy Pages.

Kalau merge-nya bentrok, workflow berhenti **tanpa mendorong apa pun** dan membuka issue.
Situs tetap seperti sebelumnya. Karena fork ini tidak pernah mengubah file upstream,
ini seharusnya tidak pernah terjadi.

Menyelesaikannya secara manual:

```bash
git remote add upstream https://github.com/osnailcyargta-ctrl/fps.git   # sekali saja
git fetch upstream
git merge upstream/main
git push
```

---

## Syarat browser

| | |
|---|---|
| Kontrol sentuh | Pointer Events — semua browser modern |
| Mod | Service Worker + IndexedDB + `DecompressionStream` |
| Game | WebGL2 |

Mod butuh halaman dilayani lewat `http(s)`. Lewat `file://` service worker tidak jalan,
jadi mod mati sementara kontrol sentuh tetap bekerja.

---

## Menjalankan lokal

```bash
python -m http.server 8000
```

Lalu buka `http://localhost:8000/launcher/`. `localhost` dihitung secure context, jadi
service worker dan mod tetap bekerja.
