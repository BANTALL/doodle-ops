// The "CONTOH .ZIP" button. Hands the player a mod that actually does something,
// so the first thing they install already works and can be edited from there.

import { zipStore } from './zipwrite.js';

const MOD_JSON = `{
  "name": "Contoh Mod",
  "version": "1.0.0",
  "author": "kamu",
  "description": "Mod contoh: mengubah statistik senjata dan menambah skrip kecil.",
  "scripts": ["mods/contoh/init.js"]
}
`;

const INIT_JS = `// Dijalankan setelah game siap. window.DoodleMods dan window.__game sudah ada.
//
// Skrip seperti ini cocok untuk tweak kecil. Untuk perubahan besar, salin file
// aslinya dari repo ke dalam zip pada path yang sama (misal src/player.js) dan
// ubah sesukamu - file itulah yang akan dimuat game.

const M = window.DoodleMods;

M.onReady((game) => {
  M.log('Contoh Mod aktif. Objek game:', game);

  // 1) Ubah nilai apa pun yang sudah ada di memori.
  game.player.maxHealth = 150;
  game.player.health = 150;

  // 2) Bungkus method yang ada tanpa menyalin seluruh file.
  M.wrap(game.player, 'useSkill', (original) => function (...args) {
    const used = original.apply(this, args);
    if (used) game.toast('SKILL DIPAKAI (dari Contoh Mod)');
    return used;
  });

  game.toast('CONTOH MOD DIMUAT');
});
`;

const README = `Contoh Mod untuk DOODLE OPS Launcher
====================================

Struktur zip mengikuti struktur repo. Path di dalam zip = path file yang diganti.

  mod.json                  metadata mod (wajib kalau mau nama/versi/skrip sendiri)
  mods/contoh/init.js       skrip yang dijalankan setelah game siap
  src/weapons.js            <- HAPUS baris ini dan salin file asli dari repo
                               kalau kamu mau benar-benar mengganti senjata

Cara mengganti file game:
  1. Buka https://github.com/bantall/doodle-ops
  2. Salin file yang ingin diubah, misalnya src/player.js
  3. Taruh di zip pada path yang persis sama: src/player.js
  4. Edit sesukamu, zip ulang, install lewat menu MOD

Mod tidak cuma bisa MENGGANTI file. Path yang belum ada di repo juga dilayani, jadi
kamu boleh membawa modul JS baru, tekstur baru, atau audio baru, lalu memanggilnya dari
skrip mod ini atau dari file yang kamu ganti.

Yang tidak boleh diganti: sw.js dan apa pun di launcher/ - itu launchernya sendiri.

Semua perubahan hanya ada di browser kamu. Repo di GitHub tidak tersentuh, dan
mematikan mod mengembalikan game ke aslinya.
`;

export function templateZip() {
  return zipStore([
    { name: 'mod.json', text: MOD_JSON },
    { name: 'mods/contoh/init.js', text: INIT_JS },
    { name: 'README.txt', text: README },
  ]);
}
