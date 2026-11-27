# Supermemory Local + 9router (Docker Compose)

Memori persisten untuk agent coding. Server **Supermemory** ([supermemory.ai](https://supermemory.ai/docs/self-hosting/overview)), gateway LLM **9router**, dan dua relay kecil berjalan sebagai **container lewat Docker Compose**, di Mac Anda atau di VPS (Dokploy). Hooks untuk **Claude Code**, **Antigravity** dan **OpenCode** serta gateway MCP **supergateway** tetap berjalan di Mac.

Kode ditulis dalam TypeScript sebagai **monorepo Bun workspaces** (satu folder per service di `apps/`, kode bersama di `packages/`), dijalankan langsung oleh **Bun** (tanpa build), dengan dependency injection memakai **tsyringe**. Tiap service punya Dockerfile sendiri, sehingga bisa dideploy sebagai container terpisah di Dokploy. Memori diisolasi **per folder / repository Git** dan **dibagikan lintas sesi dan lintas agent CLI**.

---

## 🧩 Arsitektur

```text
 Mac                                              Docker Compose (Mac atau VPS)
┌───────────────────────────────┐   HTTP    ┌──────────────────────────────────────────────────┐
│ Claude Code / Antigravity /   │──────────▶│ supermemory :6767   (server memori + embedding)  │
│ OpenCode  ── hooks (bun)      │           │      │ LLM + embeddings                          │
│                               │           │      ▼                                           │
│ supergateway :20131 (MCP)     │           │ llm-proxy :20129 ──▶ 9router :20128 ──▶ provider │
│                               │           │                          ▲                       │
│ Zed ──────────────────────────┼──────────▶│ zed-adapter :20130 ──────┘                       │
└───────────────────────────────┘           └──────────────────────────────────────────────────┘
```

| Layanan       | Berjalan di                   | Fungsi                                                                                                          |
| ------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `supermemory` | container                     | Server memori (binary rilis resmi, checksum diverifikasi saat build), embedding lokal `Xenova/bge-base-en-v1.5` |
| `9router`     | container (`decolua/9router`) | Gateway LLM kompatibel OpenAI, menyimpan login provider                                                         |
| `llm-proxy`   | container                     | Perantara supermemory → 9router: `stream:false` di chat, `dimensions` dan `usage` di embeddings                 |
| `zed-adapter` | container                     | Mengubah `/v1/completions` milik Zed menjadi `/chat/completions` 9router                                        |
| hooks         | Mac (bun)                     | Menyuntik dan menyimpan memori per sesi agent                                                                   |
| supergateway  | Mac (brew)                    | Satu pintu untuk semua server MCP di `mcp-config.json`                                                          |

Server MCP seperti playwright, chrome-devtools, pdfcraft dan figcraft butuh mesin Anda, sehingga supergateway tidak ikut di container.

---

## 📁 Struktur Project

```text
supermemory-local/
├── apps/
│   ├── supermemory-server/     # Dockerfile (binary rilis) + entrypoint.sh + .env.example
│   ├── 9router/                # Dockerfile (image decolua/9router) + .env.example
│   ├── llm-proxy/              # Dockerfile + src: proxy supermemory → 9router
│   ├── zed-adapter/            # Dockerfile + src: adapter edit prediction Zed
│   └── hooks/                  # jalan di Mac: hook, installer, self-test, plugin OpenCode
├── packages/
│   ├── shared/                 # tsyringe (di.ts), logger, env, Bun.serve
│   └── client/                 # client HTTP server memori + resolver project
├── docker-compose.yml          # 4 layanan sekaligus, hanya `expose` (stack lokal)
├── docker-compose.local.yml    # tambahan lokal: publish port ke 127.0.0.1
├── mcp-config.json             # server MCP untuk supergateway lokal
├── .env.example                # konfigurasi lokal (compose + hooks)
├── bin/supermemory-hook.ts     # entrypoint hook semua agent
├── bunfig.toml                 # linker hoisted agar @supermemory-local/* ter-resolve dari root
└── scripts/                    # start.sh, stop.sh, status.sh, lib.sh
```

Tiap app/package punya `package.json` (nama `@supermemory-local/<nama>`), `config.ts` (konfigurasi dari env), kelas layanan dengan constructor injection, `container.ts` (composition root tsyringe) dan test di sebelahnya. Semua import absolut: `@/…` untuk file di app yang sama (`paths` di `tsconfig.json` tiap app) dan `@supermemory-local/shared/…` atau `@supermemory-local/client/…` untuk package bersama. Kelas tidak memakai dekorator: wiring seluruhnya di `container.ts`, sehingga hook tetap berfungsi saat Bun dijalankan dari folder proyek mana pun.

---

## 🚀 Menjalankan di Mac

Prasyarat: [Bun](https://bun.sh), Docker (OrbStack atau Docker Desktop), dan `brew install supercorp-ai/tap/supergateway`.

```bash
bun install
cp .env.example .env     # isi OPENAI_API_KEY, NINEROUTER_PASSWORD, CONTEXT7_API_KEY
bun run start            # docker compose up + supergateway
bun run status
bun run logs             # docker compose logs -f
bun run stop             # docker compose down + stop supergateway (volume dan data tetap)
```

`start` membangun image, menunggu semua container `healthy` (boot pertama mengunduh model embedding ±50 detik), lalu menyalakan supergateway. Port dipublish hanya ke `127.0.0.1`:

| URL                                     | Isi                         |
| --------------------------------------- | --------------------------- |
| `http://127.0.0.1:6767`                 | Supermemory                 |
| `http://127.0.0.1:20128`                | Dashboard dan `/v1` 9router |
| `http://127.0.0.1:20129`                | llm-proxy                   |
| `http://127.0.0.1:20130/v1/completions` | Adapter Zed                 |
| `http://127.0.0.1:20131/<server>/mcp`   | Gateway MCP                 |

`bun run start:mcp` / `stop:mcp` hanya mengurus supergateway, dipakai bila server memori berjalan di VPS.

### Data lokal

- `SUPERMEMORY_DATA=./data/supermemory` menyimpan store memori di folder proyek (`data/supermemory/stores/<model>-<dim>d`, `data/supermemory/current` menunjuk ke store aktif).
- `NINEROUTER_DATA=${HOME}/.9router` memakai login provider 9router yang sudah ada.
- Kosongkan keduanya untuk memakai named volume Docker (`supermemory-data`, `ninerouter-data`), seperti di Dokploy.
- Container 9router memakai `~/.9router` yang sama dengan 9router lokal. Jangan jalankan keduanya bersamaan.

### Memori lama (versi tanpa Docker)

Store buatan binary macOS terenkripsi dengan kunci turunan ID hardware Mac, jadi **container Linux tidak bisa membukanya** (error `Could not unlock local storage`) dan salinan folder tidak cukup. Memori lama di `data/stores/` tidak dihapus dan tidak dipakai. Pilihannya:

- Biarkan dan mulai dari store kosong di container.
- Migrasi lewat API dengan `bun run migrate`. Perintah ini selalu memuat `.env` repo (`--env-file=.env`): tujuan impor diambil dari `SUPERMEMORY_API_URL` dan `SUPERMEMORY_API_KEY` di sana (sejak server 0.0.9 key wajib terisi, juga lewat SSH tunnel; kosong hanya berfungsi di 0.0.8 ke bawah, lihat bagian Autentikasi). Server macOS lama tidak bisa dipindah port (selalu 6767), jadi saat ekspor tunjuk lewat variabel di baris perintah, yang menimpa `.env`.
  1. Jalankan biner lama pada salinan store (`~/.supermemory/bin/supermemory-server` dengan `SUPERMEMORY_DATA_DIR` ke salinan itu), lalu `SUPERMEMORY_API_URL=http://<ip-lan>:6767 SUPERMEMORY_API_KEY=$(cat <salinan>/api-key) bun run migrate export`. Bila 6767 di `localhost` sudah dipakai tunnel, pakai IP LAN Mac. Hasilnya `data/migration/export.json`: semua `session_summary` dan 20 catatan perubahan terbaru per project (`--obs-per-project`, `--tag`).
  2. Arahkan `.env` ke server tujuan, lalu `bun run migrate import` (urut dari yang terlama, `customId` `migrated-<id>` mencegah duplikat, tanggal asli ada di `metadata.timestamp`). Skrip hanya mengirim saat dokumen yang sedang diproses di server kurang dari `--max-inflight` (50), dan berhenti bila server tidak maju 10 menit atau 5 dokumen gagal berturut-turut.
  3. Lanjutkan setelah terputus (atau setelah server tujuan di-upgrade) dengan `bun run migrate import --reconcile` (membandingkan isi server dengan berkas export). `--resend-status failed` mengirim ulang dokumen yang gagal diproses, `--dry-run` hanya menghitung.
  4. Server tidak melanjutkan dokumen yang antreannya hilang saat crash dan tidak bisa menghapusnya (409), jadi jangan kirim sekaligus ke server dengan batas memori ingest kecil (`SUPERMEMORY_EMBEDDING_RAM_LIMIT`). Server memproses sekitar 25 dokumen per menit, sehingga 2.229 dokumen butuh 1–2 jam. Bila laju turun jauh (beberapa dokumen per menit), hentikan impor dan cek log `supermemory-server` dan `9router`; mengirim lebih banyak hanya menambah antrean.
  5. Urutan yang aman untuk server tujuan yang masih 0.0.8: hentikan impor, upgrade server ke 0.0.9 lewat prosedur resmi (bagian Pembaruan dan backup), isi `SUPERMEMORY_API_KEY` di `.env`, lalu `bun run migrate import --reconcile`. Dokumen yang sudah `done` tidak dikirim ulang.

### Tes memori

```bash
bun run test-memory
```

Memakai tag `<project>_selftest` supaya catatan uji tidak bercampur dengan memori asli, dan exit code 1 bila gagal.

---

## 🔑 Autentikasi

- Sejak supermemory-server 0.0.9 **setiap** request, termasuk dari localhost dan lewat SSH tunnel, harus membawa `Authorization: Bearer <key>`; tanpa itu 401. Satu-satunya pengecualian `GET /v3/health`, dipakai healthcheck. Server 0.0.8 ke bawah masih menerapkan key-nya sendiri untuk request loopback.
- Hook membaca key dari `SUPERMEMORY_API_KEY`, atau dari `data/supermemory/current/api-key` bila variabelnya **tidak ada** (cocok untuk mode lokal dengan bind mount). Untuk server jauh atau SSH tunnel isi key-nya di sini. Diisi **kosong** (`SUPERMEMORY_API_KEY=`) berarti tanpa header, hanya berfungsi di server 0.0.8 ke bawah. Key dibuat server saat boot pertama dan tidak bisa ditentukan sendiri.
- Hook tidak pernah memblokir agent: key salah atau server tak terjangkau hanya membuat hook diam (exit 0).

---

## 🌐 Deploy ke VPS dengan Dokploy

Tiap service di `apps/` dideploy sebagai **Application** Dokploy tersendiri dari repo yang sama (monorepo): empat container terpisah, masing-masing punya environment, volume, domain dan log sendiri. Mac hanya menjalankan hooks dan supergateway (server MCP seperti playwright butuh mesin Anda, jadi tetap lokal).

| App Dokploy          | Dockerfile Path                      | Port    | Volume (Advanced → Volumes)     | Domain                                                  |
| -------------------- | ------------------------------------ | ------- | ------------------------------- | ------------------------------------------------------- |
| `9router`            | `apps/9router/Dockerfile`            | `20128` | `ninerouter-data` → `/app/data` | `router.example.com`                                    |
| `llm-proxy`          | `apps/llm-proxy/Dockerfile`          | `20129` | -                               | tidak ada (internal)                                    |
| `supermemory-server` | `apps/supermemory-server/Dockerfile` | `6767`  | `supermemory-data` → `/data`    | `memory.example.com`                                    |
| `zed-adapter`        | `apps/zed-adapter/Dockerfile`        | `20130` | -                               | `zed.example.com` (opsional, wajib `ZED_ADAPTER_TOKEN`) |

### 1. Siapkan VPS dan domain

- VPS Linux dengan minimal 2 GB RAM dan 30 GB disk, port `80`, `443` dan `3000` bebas.
- Subdomain yang mengarah ke IP VPS lewat record **A**, misalnya `memory.example.com`, `router.example.com` dan (opsional) `zed.example.com`.
- Repo ini ada di GitHub/GitLab/Git yang bisa dibaca Dokploy (public, atau private dengan akses yang sudah dihubungkan).

### 2. Pasang Dokploy

```bash
ssh root@<ip-vps>
curl -sSL https://dokploy.com/install.sh | sh
```

Skrip memasang Docker bila belum ada. Setelah selesai buka `http://<ip-vps>:3000` dan buat akun admin. Pastikan firewall mengizinkan port 80, 443 dan 3000.

### 3. Buat empat Application

Dalam satu project, ulangi untuk tiap baris tabel di atas: **Create Service** → **Application**, lalu tab **General**:

1. **Provider**: GitHub atau Git, pilih repo dan branch. **Build Path**: `/`.
2. **Build Type**: `Dockerfile`.
3. Kolom **Docker File** (Dockerfile Path): sesuai tabel. **Docker Context Path**: isi `.` secara eksplisit (akar repo, karena build butuh `packages/` dan `bun.lock`). Jangan dikosongkan: placeholder "default: ." menyesatkan, kolom kosong membuat Dokploy memakai folder tempat Dockerfile berada (`apps/<service>/`) sehingga `bun install` gagal dengan `Workspace dependency "@supermemory-local/shared" not found`. Simpan.

Dokploy menampilkan **App Name** di bawah nama service (bentuk `project-service-hash`). Itu hostname internal service di jaringan Dokploy, dan dipakai di URL antar-service pada langkah 4.

### 4. Isi Environment dan Volume

Variabel dibagi dua kelompok. Nilai yang harus sama di beberapa app ditulis **sekali** di **variabel project**, sisanya khusus app.

**Variabel project** (halaman project → tab **Environment**, isi `dokploy.env.example`). App merujuknya dengan `${{project.NAMA}}`:

| Variabel                           | Dipakai oleh                        | Isi                                                                                        |
| ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `NINEROUTER_URL`                   | `llm-proxy`, `zed-adapter`          | `http://<App Name 9router>:20128/v1`                                                       |
| `LLM_PROXY_URL`                    | `supermemory-server`                | `http://<App Name llm-proxy>:20129`                                                        |
| `OPENAI_API_KEY`                   | `supermemory-server`, `zed-adapter` | string apa saja selama 9router belum mewajibkan key; sesudahnya key dari dashboard 9router |
| `SUPERMEMORY_EMBEDDING_DIMENSIONS` | `supermemory-server`, `llm-proxy`   | `768`; harus sama di keduanya, ganti bersama model embedding                               |

**Khusus app** (tab **Environment** tiap app, isi `apps/<service>/.env.example`; baris `${{project.…}}` di sana disalin apa adanya):

| App                  | Variabel khusus                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `9router`            | `INITIAL_PASSWORD` (`openssl rand -hex 16`), `REQUIRE_API_KEY`                                                                                       |
| `llm-proxy`          | tidak ada (`OPENAI_BASE_URL` dan dimensi dari variabel project)                                                                                      |
| `supermemory-server` | `OPENAI_MODEL`, `SUPERMEMORY_EMBEDDING_PROVIDER`, `SUPERMEMORY_EMBEDDING_MODEL`, `SUPERMEMORY_INGEST_CONCURRENCY`, `SUPERMEMORY_EMBEDDING_RAM_LIMIT` |
| `zed-adapter`        | `ZED_ADAPTER_TOKEN` (`openssl rand -hex 24`), `ZED_ADAPTER_REASONING_EFFORT`                                                                         |

`OPENAI_BASE_URL` sengaja tidak dibagi: nilainya berbeda per app (`supermemory-server` ke `llm-proxy`, yang lain ke 9router). Variabel yang hanya dipakai di Mac (`SUPERMEMORY_API_URL`, `SUPERMEMORY_API_KEY`, `TRANSLATE_MODEL`, `CONTEXT7_API_KEY`) tidak dimasukkan ke Dokploy. Urutan pengisian: variabel project dulu (kecuali URL, isi setelah App Name tiap app ada), lalu `9router`, `llm-proxy`, `supermemory-server`, `zed-adapter`.

Tab **Advanced** → **Volumes** → **Volume Mount** untuk `9router` dan `supermemory-server` sesuai tabel (data hilang tiap deploy tanpa volume). Biarkan replica 1.

> **Jangan ganti atau buat ulang app `llm-proxy`.** Server memori mengunci alamat embedding-nya (`embedding-plan.json`), jadi App Name baru membuat store lama menolak boot. Bila terpaksa, kembalikan App Name yang sama.

### 5. Pasang domain

Tab **Domains** → **Create Domain** di app yang bertanda domain pada tabel: **Host**, **Container Port** dari tabel, **HTTPS** ON, **Certificate** Let's Encrypt. Dokploy memasang Traefik di depan container, tanpa `ports`. Jangan beri domain ke `llm-proxy`: ia tidak punya autentikasi dan meneruskan ke akun LLM Anda. `zed-adapter` hanya boleh publik bila `ZED_ADAPTER_TOKEN` terisi (tanpa token adapter menjawab siapa saja).

### 6. Deploy

Deploy berurutan: `9router`, `llm-proxy`, `supermemory-server`, `zed-adapter`. Pantau tab **Logs** tiap app. Healthcheck ada di Dockerfile, dan boot pertama `supermemory-server` butuh beberapa menit (unduh binary dan model embedding). Domain baru hidup setelah container `healthy`.

### 7. Login provider di 9router

Buka `https://router.example.com`, login dengan `INITIAL_PASSWORD`, lalu tambahkan provider. Alternatifnya salin data dari Mac saat container 9router berhenti: kirim `~/.9router/{db,auth,jwt-secret,machine-id}` ke volume `ninerouter-data` di VPS (ubah pemilik ke uid 1000).

Untuk mengunci `/v1` dengan key: buat API key di dashboard, isi `OPENAI_API_KEY` di `supermemory-server` dan `zed-adapter` dengan key itu, set `REQUIRE_API_KEY=true` di `9router`, lalu deploy ulang ketiganya.

### 8. Ambil API key server memori

Buka tab **Terminal** app `supermemory-server` lalu jalankan `cat /data/current/api-key`. Image resmi tidak mencetak key di log (`SUPERMEMORY_HIDE_API_KEY_IN_LOGS=1`).

### 9. Arahkan Mac ke VPS

Ubah `.env` di Mac:

```ini
SUPERMEMORY_API_URL=https://memory.example.com
SUPERMEMORY_API_KEY=<key dari langkah 8>
OPENAI_BASE_URL=https://router.example.com/v1
OPENAI_API_KEY=<key 9router bila REQUIRE_API_KEY=true>
CURL_IMPERSONATE=chrome152_macos
```

`CURL_IMPERSONATE` membuat hook dan client mengirim request lewat `curl-impersonate` (`brew install curl-impersonate`; profil TLS/HTTP2-nya ikut nama yang diisi, misalnya `chrome152_macos`). Ini hanya untuk Mac: container tetap memakai `fetch` ke jaringan internal Docker, jadi Dockerfile tidak berubah. Butuh biner di path lain? Isi `CURL_IMPERSONATE_BIN`.

**Kembali ke SSH tunnel.** Kosongkan `CURL_IMPERSONATE`, lalu arahkan URL ke port tunnel:

```ini
SUPERMEMORY_API_URL=http://localhost:6767
OPENAI_BASE_URL=http://127.0.0.1:20128/v1
```

Hooks membaca `.env` di setiap panggilan, jadi tidak perlu dipasang ulang. Lalu jalankan hanya gateway MCP:

```bash
bun run stop        # matikan stack lokal bila masih berjalan
bun run start:mcp
bun run install-hooks
bun run test-memory
```

Zed: `api_url` `https://zed.example.com/v1/completions` dan `ZED_ADAPTER_TOKEN` sebagai API key provider.

**Otomatis sejak login (launchd).** Bila server dijangkau lewat tunnel `ssh contaboo-tunnel` (alias di `~/.ssh/config`), tunnel dan supergateway bisa dijalankan sebagai LaunchAgent: hidup sejak login dan dijalankan ulang bila mati. Agent tunnel hanya dipasang bila `CURL_IMPERSONATE` kosong; begitu variabel itu diisi, `install` menghapus agent tunnel dan menyisakan gateway saja (gateway tetap perlu: MCP server di `mcp-config.json` terikat ke laptop).

```bash
bun run stop:mcp && pkill -f 'ssh .*contaboo-tunnel'   # hentikan yang dijalankan manual lebih dulu
bun run launchd install      # tulis ~/Library/LaunchAgents/local.supermemory.{tunnel,gateway}.plist dan jalankan
bun run launchd status | start | stop
bun run launchd uninstall    # hapus kedua agent (log di data/ tetap); pakai ini sebelum install ulang setelah mengganti CURL_IMPERSONATE
```

`install` menolak berjalan bila tunnel atau gateway manual masih hidup (port-nya terpakai). Setelah terpasang, `stop:mcp` tidak mematikan gateway (PID-nya dipegang launchd): pakai `launchd stop`. LaunchAgent mulai saat login, bukan sebelum login: aktifkan login otomatis bila Mac harus siap tanpa dijaga. Log: `data/tunnel.log` dan `data/supergateway.log`. Di mode `CURL_IMPERSONATE` tidak ada tunnel, jadi `status` mencetak `egress : curl-impersonate (...)` alih-alih cek `:6767`.

### 10. Pembaruan dan backup

- Perubahan kode: push ke branch, lalu **Deploy** ulang app yang berubah. Untuk deploy otomatis, salin **Webhook URL** dari tab **Deployments** tiap app ke repo (Settings → Webhooks, event Push), dan isi **Watch Paths** (tab General) supaya push hanya men-deploy app yang terkena: `apps/llm-proxy/**`, `packages/shared/**`, `bun.lock` untuk `llm-proxy` (sama untuk `zed-adapter`); `apps/supermemory-server/**` untuk server memori; `apps/9router/**` untuk 9router.
- Versi 9router: `ARG NINEROUTER_VERSION` di `apps/9router/Dockerfile`. Versi supermemory-server: `ARG SUPERMEMORY_VERSION` di `apps/supermemory-server/Dockerfile`.
- Backup: volume `supermemory-data` (memori) dan `ninerouter-data` (login provider).
- **Upgrade supermemory-server** (prosedur resmi, <https://supermemory.ai/docs/self-hosting/docker>): (1) tunggu impor/ingest selesai, karena restart mematikan antrean dokumen yang sedang diproses; (2) hentikan app lalu salin seluruh `/data` (di VPS: `docker run --rm -v <volume>:/data -v "$PWD":/backup alpine tar czf /backup/supermemory-data.tgz -C /data .`); (3) naikkan `ARG SUPERMEMORY_VERSION`, push, **Deploy**; (4) cek `GET /v3/health` lalu `bun run test-memory` dengan `SUPERMEMORY_API_KEY` terisi. Server baru memverifikasi backup lengkap sebelum memigrasi store, dan cleanup-nya bisa menghapus dokumen duplikat lama beserta tautan sumbernya. Rollback hanya dengan memulihkan backup dan memakai versi lama; jangan arahkan image lama ke store yang sudah dimigrasi. Jangan `docker compose down -v` atau hapus volume.

### Alternatif: satu stack Compose

Bila lebih suka satu service untuk keempatnya: **Create Service** → **Compose**, **Compose Type** `Docker Compose`, **Compose Path** `./docker-compose.yml`. Environment diisi dari `.env.example` (bagian compose), domain per service lewat tab **Domains** (`supermemory` `6767`, `9router` `20128`). File compose yang sama dipakai lokal.

### Catatan

- Image dan compose sudah diuji di OrbStack (Linux arm64), termasuk image `zed-adapter` yang dijalankan sendiri dengan env URL ke 9router. Langkah Dokploy mengikuti dokumentasinya, tetapi belum dijalankan di VPS sungguhan (terutama Watch Paths, Terminal, dan OAuth dari dashboard remote).

---

## 🔍 Cara Kerja Tiap Hook

Semua agent memanggil `bun --env-file=<repo>/.env bin/supermemory-hook.ts <agent> <aksi>` dengan payload JSON di stdin. Teks yang dicetak aksi `start`/`sync` menjadi konteks model.

### A. Claude Code (`~/.claude/settings.json`)

- **`SessionStart`** (`startup|resume|clear|compact`): `start`. Mengambil memori project terbaru (maks. 5 ringkasan sesi dan 10 perubahan) plus fakta hasil ekstraksi server (`/v4/profile`), lalu menyuntiknya sebagai `<supermemory-context>`.
- **`UserPromptSubmit`**: `sync` di setiap prompt. Hanya memori baru dari agent/sesi lain sejak konteks terakhir yang disuntik (marker per sesi di `$TMPDIR/supermemory-sync/`). Prompt juga dipakai sebagai query hybrid search (`/v4/search`), diterjemahkan dulu ke bahasa Inggris lewat `TRANSLATE_MODEL` bila perlu. Prompt 1–2 kata dilewati dan tiap hasil disuntik sekali per sesi.
- **`PostToolUse`** (`Write|Edit|MultiEdit|NotebookEdit|Bash`): mencatat nama tool dan path file atau command. Command read-only (`ls`, `cat`, `git status`, dst.) diabaikan.
- **`Stop`**: menyimpan balasan terakhir asisten (maks. 4000 karakter, diterjemahkan ke bahasa Inggris bila perlu).
- **`PostCompact`**: menyimpan ringkasan compaction dari `transcript_path` (maks. 40.000 karakter).

### B. Antigravity (`~/.gemini/config/hooks.json`)

- **`PreInvocation`**: `start` sebelum setiap panggilan model, dengan cache 30 detik per percakapan. Mengembalikan `{ "injectSteps": [{ "ephemeralMessage": "<supermemory-context>..." }] }`.
- **`PostToolUse`** (`write_to_file|write_file|replace_file_content|multi_replace_file_content|edit_file|run_command`): mencatat eksekusi tool, command read-only diabaikan. Selalu menjawab JSON (`{}`).
- **`Stop`**: menyimpan balasan terakhir dari `transcriptPath` (entri `PLANNER_RESPONSE`).
- Antigravity tidak punya hook compaction.

### C. OpenCode (`~/.config/opencode/plugins/supermemory-local.ts`)

- Plugin dibuat dari `apps/hooks/src/opencode-plugin.ts` oleh installer dan otomatis ter-load dari folder plugins global. Jangan mendaftarkannya di `opencode.json` (ter-load dua kali).
- Memakai API **OpenCode 2.x** (`export default { id, setup(ctx) }`, docs: opencode.ai/v2/docs/build/plugins/): `ctx.session.hook('context')` menyuntik memori sebelum tiap panggilan model, `ctx.tool.hook('execute.after')` mencatat tool, `session.execution.succeeded` menyimpan ringkasan, `session.compaction.ended` menyimpan ringkasan compaction (isi event belum terdokumentasi, belum terverifikasi).
- Instance plugin lama bertahan di service latar belakang; jalankan `opencode service restart` setelah mengubah plugin. Plugin berubah hanya setelah `bun run install-hooks opencode`.

### Instalasi hooks

```bash
bun run install-hooks [all|claude-code|antigravity|opencode]
bun run uninstall-hooks [all|claude-code|antigravity|opencode]
```

Setiap file konfigurasi yang diubah dibackup dulu sebagai `.bak-<timestamp>`. Installer menulis path absolut bun dan repo ini, jadi pindah folder berarti pasang ulang.

---

## ✏️ Zed Edit Prediction

Provider `open_ai_compatible_api` di Zed memakai format legacy `/v1/completions` (`{"prompt": ...}`), sedangkan 9router hanya punya `/chat/completions`. `zed-adapter` menerjemahkannya, mengirim `reasoning_effort` dari `ZED_ADAPTER_REASONING_EFFORT` (default `none`), membuang pembungkus ` ``` `, menerapkan `stop` secara lokal, dan memasang kembali marker zeta `<|editable_region_start|>` / `<|editable_region_end|>` bila hilang.

```json
"edit_predictions": {
  "provider": "open_ai_compatible_api",
  "open_ai_compatible_api": {
    "api_url": "http://127.0.0.1:20130/v1/completions",
    "model": "cc/claude-haiku-4-5-20251001",
    "prompt_format": "zeta"
  }
}
```

Pakai model tanpa thinking berat. Isi `ZED_ADAPTER_TOKEN` untuk mewajibkan `Authorization: Bearer <token>` (Zed mengirimnya sebagai API key provider); tanpa token adapter terbuka untuk siapa saja, jadi jangan diberi domain publik.

---

## 🔌 Gateway MCP (supergateway)

[supergateway](https://github.com/supercorp-ai/supergateway) membaca `mcp-config.json` (format `mcpServers`) dan melayani tiap server di `http://127.0.0.1:20131/<nama>/mcp` (Streamable HTTP, stateful: satu proses per sesi klien). `bun run start`/`start:mcp` menjalankannya (PID `.supergateway.pid`, log `data/supergateway.log`), `status` menampilkannya, `stop` menghentikannya.

- Tambah/ubah server: edit `mcp-config.json`, cek dengan `bun run mcp:check`, lalu restart (`bun run stop:mcp && bun run start:mcp`).
- Rahasia (`CONTEXT7_API_KEY`) ditulis sebagai `${VAR}` dan diisi dari `.env`; variabel kosong membuat gateway gagal start.
- `port` di `mcp-config.json` dan `MCP_GATEWAY_PORT` harus sama (default `20131`).
- Klien: Claude Code `claude mcp add --transport http -s user <nama> http://127.0.0.1:20131/<nama>/mcp`; Antigravity (`~/.gemini/config/mcp_config.json`) `{"serverUrl": "..."}`; OpenCode v2 (`opencode.json`) `"mcp": {"servers": {"<nama>": {"type": "remote", "url": "..."}}}`.
- Gateway mati berarti semua alat MCP gagal tersambung.

---

## 🛠️ Pemeliharaan

### Reset memori

```bash
bun run stop
rm -rf data/supermemory "${TMPDIR}supermemory-sync"     # bind mount lokal
# named volume: docker volume rm supermemory_supermemory-data
bun run start
```

### Mengganti model

Semua model diatur di `.env`; setelah mengubahnya jalankan `bun run stop && bun run start` agar container dibuat ulang dengan env baru.

**Model embedding (`SUPERMEMORY_EMBEDDING_*`).** Server mengunci folder data ke provider, model, dimensi dan endpoint yang pertama mengisinya (`embedding-plan.json`) dan menolak boot bila berbeda. Karena itu entrypoint memakai satu store per model (`stores/<model>-<dim>d`): model baru mendapat store kosong, dan kembali ke model lama membuka store lamanya. Memori tidak dibagi antar model.

1. Cek dimensi model baru lewat 9router. Hasilnya harus ≤ 2000 dan model harus menghormati `dimensions`:
   ```bash
   set -a; source .env; set +a
   curl -s http://127.0.0.1:20128/v1/embeddings -H "Authorization: Bearer $OPENAI_API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"model":"<model-baru>","input":"tes","dimensions":1024}' \
     | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"][0]["embedding"]))'
   ```
2. Ubah `SUPERMEMORY_EMBEDDING_MODEL` (dan `_DIMENSIONS`, `_PROVIDER` bila perlu), lalu `bun run stop && bun run start`.
3. Opsional: hapus store model yang tidak dipakai (`rm -rf data/supermemory/stores/<nama>`).

Endpoint embedding (`http://llm-proxy:20129`) ikut terkunci, jadi mengganti nama atau port layanan itu membuat store yang ada menolak boot.

**Terjemahan (`TRANSLATE_MODEL`).** Model embedding yang hanya berbahasa Inggris butuh model chat yang menerjemahkan prompt dan ringkasan sesi ke bahasa Inggris (timeout 8 detik; gagal berarti teks asli dipakai). Ubah tanpa restart (hook membaca `.env` di tiap panggilan). Embedding multibahasa (mis. Jina): kosongkan `TRANSLATE_MODEL=`.

**Model ekstraksi memori (`OPENAI_MODEL`).** Tidak terkunci. Pastikan model membalas JSON:

```bash
curl -s http://127.0.0.1:20128/v1/chat/completions -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"<model-baru>","stream":false,"response_format":{"type":"json_object"},"messages":[{"role":"user","content":"balas {\"ok\":true}"}]}'
```

Lalu ubah `OPENAI_MODEL` dan restart. Panggilan baru di `docker compose logs llm-proxy` harus berstatus `200`.

### Menghapus dokumen satu container tag

```bash
bun --env-file=.env -e '
import { SupermemoryClient } from "@supermemory-local/client/client";
import { loadSupermemoryConfig } from "@supermemory-local/client/config";
import { ProjectResolver } from "@supermemory-local/client/project-resolver";
const client = new SupermemoryClient(loadSupermemoryConfig());
const tag = new ProjectResolver().resolve("/tmp/sm-compact-test").containerTag;
for (const d of await client.listDocuments({ containerTags: [tag], limit: 100 }))
  console.log(d.id, (await client.request("DELETE", `/v3/documents/${d.id}`)).error ?? "deleted");'
```

Dokumen yang masih diproses ditolak dengan `HTTP 409: Document is still processing`; tunggu ekstraksi selesai lalu ulangi.

### Pengembangan

```bash
bun test               # unit test + test berbasis DI di tiap app/package
bun run typecheck
bun run format
```

### Log

- Container: `bun run logs` atau `docker compose logs <layanan>` (`supermemory`, `9router`, `llm-proxy`, `zed-adapter`)
- Gateway MCP: `data/supergateway.log`
- Hooks: `~/.supermemory-hook.log`
