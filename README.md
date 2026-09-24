# Meyar ERP 2

Azərbaycan dilində ayrıca masaüstü uçot proqramı. **v0.1.0 — ilkin işlək versiya, istehsalat buraxılışı deyil.**

## Hazır olanlar

- Şirkətlər və VÖEN üzrə kontragent kitabçası; şirkət məlumatlarının ayrılığı.
- Gələn/gedən qaimələr, mal/xidmət seçimi, 721 üçün subkonto.
- Qaimə saxlananda avtomatik ikili yazılış; debet və kreditin bərabərliyi yoxlanılır.
- 223 və 224.04 hesabları üzrə daxil olan/çıxan borc ödənişləri, qaimə ilə əlaqələndirmə.
- Tarix və hesab filtri ilə DBC, müxabirləşmə jurnalı, debitor və kreditor qalıqları.
- Excel şablonu, idxaldan əvvəl baxış, təkrar qaimənin yenilənməsi; səhv idxal tam geri qaytarılır.
- Sənəd düzəlişi/ləğvi üçün əks yazılış və dəyişiklik tarixçəsi.
- Dövr bağlanışı, açılışda və əl ilə SQLite ehtiyat nüsxələri.
- Ağ–yaşıl görünüş, yuxarı modul menyusu, aşağı açıq pəncərə tabları, nazik filtrlər və zebra cədvəllər.

## İşə salmaq

Node.js 24 və npm tələb olunur. Koddan başlatmaq üçün:

```sh
npm ci
npm start
```

İnkişaf zamanı:

```sh
npm run dev
```

Windows quraşdırıcısı:

```sh
npm run dist:win
```

Nəticə `release/Meyar-ERP-2-Setup-0.1.0.exe` olur. GitHub **Actions → Windows validation and installer** hər `main` yenilənməsində testlərdən sonra quraşdırıcını artifact kimi saxlayır. Artifact ZIP konteynerindədir; daxilindəki `.exe` proqramın quraşdırıcısıdır. Artifact 14 gün saxlanılır. Yığımın tamamlandığını Actions nəticəsindən yoxlayın.

Quraşdırıcı hələ rəqəmsal imzalanmayıb. Windows onun naşirini təsdiqləyə bilməyə bilər. Avtomatik yeniləmə kanalı bu ilkin buraxılışda aktiv deyil.

## Yoxlama

```sh
npm test
npm run test:ui
node scripts/import-smoke.mjs
npm run build
```

`npm run preview` yalnız yerli, **müvəqqəti test bazası** yaradır; server bağlananda bu baza silinir. Bu rejimdə real uçot aparmayın. Masaüstü proqramın bazası bundan ayrıdır və qalıcıdır.

## Uçot qaydaları

| Sənəd                    | Debet          | Kredit       |
| ------------------------ | -------------- | ------------ |
| Satış — əsas             | 211            | 601          |
| Satış — daxil edilən ƏDV | 211            | 545          |
| Mal alışı — əsas         | 205            | 531          |
| Xidmət alışı — əsas      | 721 + subkonto | 531          |
| Alış — daxil edilən ƏDV  | 241            | 531          |
| Alıcıdan borc ödənişi    | 223 / 224.04   | 211          |
| Malsatana borc ödənişi   | 531            | 223 / 224.04 |

Məbləğlər tam qəpiklə saxlanılır. ƏDV məbləğini istifadəçi sənədə əsasən daxil edir; bu yazılışlar vergi bəyannaməsi və ya əvəzləşmə hüququ barədə avtomatik qərar deyil. Məbləği sıfır olan yazılış yaradılmır.

Düzəliş ilkin yazılışı silmir: həmin tarixə əks yazılış, sonra yeni versiyanın yazılışı yaranır. Beləliklə, açıq dövrün son qalığı düzəlir, jurnal tarixçəsi qalır; ümumi debet/kredit dövriyyəsində əks yazılışlar da görünür. Bağlı dövrə düzəliş edilmir. Ödənişlə bağlanmış qaimə əvvəl əlaqəli ödəniş ləğv edilmədən dəyişdirilmir.

## Bu versiyanın sərhədləri

Bu repository sıfırdan qurulub; köhnə `meyar-desktop` bazası avtomatik köçürülmür.

- Yalnız AZN. Xarici valyuta, məzənnə fərqləri və başlanğıc qalıq idxalı hazırlanmayıb.
- Qaimələr cəmi məbləğ səviyyəsindədir. Sətir üzrə nomenklatura, anbar, miqdar və FIFO/orta maya dəyəri yoxdur. Mal satışında 701/205 maya dəyəri yazılışı avtomatik yaranmır.
- Bank əməliyyatları borc hesablaşmaları üçündür. Avansların 422 və digər hesablarla təsnifatı yoxdur.
- Rəsmi DVX canlı əlaqəsi, bank API-si və qanunvericiliyə əsaslanan ƏDV hesabatı yoxdur. İdxal yalnız proqramın verdiyi `.xlsx` şablonudur.
- Müqavilə/bank/subkonto üçün ayrıca idarə olunan kitabçalar növbəti mərhələdədir; hazırda subkonto sənəddə yazılır.
- İstifadəçi rolları və giriş şifrəsi yoxdur; yerli cihaz hesabı giriş sərhədidir. Baza şifrələnmir. Eyni cihazdakı şirkətlərin ayrılması istifadəçi icazə sistemi deyil.
- Dövrün yenidən açılması və tətbiq daxilində ehtiyat nüsxədən bərpa UI-si yoxdur. Bərpa qaydası [arxitektura sənədində](docs/ARCHITECTURE.md) izah olunur.

Ətraflı quruluş: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Yoxlama hesabatı: [docs/VALIDATION.md](docs/VALIDATION.md).
