# Meyar ERP 2 — texniki quruluş

## Qatlar

| Qovluq      | Məsuliyyət                                                             |
| ----------- | ---------------------------------------------------------------------- |
| `shared/`   | UI və Electron arasında tipli əməliyyat müqaviləsi                     |
| `core/`     | Məbləğ/tarix validasiyası, SQLite sxemi, tranzaksiyalar və hesabatlar  |
| `electron/` | Pəncərə, dar IPC körpüsü, Excel faylları və yerli ehtiyat nüsxələr     |
| `src/`      | React formaları, modullar, iş masası və cədvəllər                      |
| `tests/`    | Real SQLite davranış testləri və DOM səviyyəli UI inteqrasiya testləri |
| `scripts/`  | İnkişaf başlatması, müvəqqəti baxış və runtime/Excel sınaqları         |

Frontend verilənlər bazasına birbaşa girmir. Electron IPC yalnız sadalanmış əməliyyatları qəbul edir; göndərən pəncərə, əsas frame və URL yoxlanılır. `sandbox`, `contextIsolation` açıq, `nodeIntegration` bağlıdır. Xarici pəncərə və naviqasiya bloklanır. Proqramın baza yolu istifadəçi girişindən alınmır.

## Maliyyə bütövlüyü

- Pul decimal mətn kimi qəbul edilir, formatdan sonra tam qəpiyə çevrilir. Səssiz üçüncü onluq yuvarlaqlaşdırması yoxdur.
- Müxabirləşmə yalnız debet və kredit bərabər olduqda saxlanılır.
- Sənəd, jurnal, yazılış və audit bir tranzaksiyadadır. İdxalın bütün sətrləri vahid tranzaksiyadadır.
- Qaimənin təkrar identifikasiyası: `company + partner/VÖEN + number + direction`. Eyni məzmun dəyişiklik yaratmır, fərqli məzmun yeni versiya yaradır.
- Bank təkrar identifikasiyası: `company + reference + direction + bankAccount`. Dəyişmiş təkrar ödəniş səssiz yenilənmir.
- Jurnal, yazılış və auditdə UPDATE/DELETE SQL trigger ilə qadağandır. Düzəlişlər əks yazılışdır.
- Həm yeni, həm də ilkin sənəd tarixi dövr bağlanışına qarşı yoxlanılır. Verilənlər bazası səviyyəsində də tenant/dövr qorunması var.
- Hesabatın bütün SELECT-ləri vahid oxu tranzaksiyasında alınır. Qalıq, dövriyyə və jurnal eyni vəziyyəti göstərir.
- Təkrar bank klikləri/idempotent sorğular əlavə yazılış yaratmır. Qaiməyə bağlanan ödəniş onun borcunu aşa bilməz.

## Qalıcı məlumatlar və ehtiyat nüsxə

Windows-da baza `%APPDATA%/Meyar ERP 2/data/meyar.sqlite`, avtomatik nüsxələr isə `%APPDATA%/Meyar ERP 2/backups` altındadır. Proqramın quraşdırılma qovluğu ilə qarışdırılmır. Uninstall istifadəçi bazasını silmir.

Açılışda sxem miqrasiyasından əvvəl SQLite backup API-si ilə ardıcıl nüsxə yaradılır. Miqrasiya tranzaksiyadadır; daha köhnə proqram yeni sxemi səssiz açmır. Ehtiyat nüsxələrə avtomatik silmə müddəti tətbiq edilmir; qovluq ölçüsü istifadəçi tərəfindən izlənməlidir.

Bərpa UI-si hazır deyil. Texniki bərpa: tətbiqi tam bağlayın, bütün cari `data` qovluğunu ayrıca qoruyun, bərpa ediləcək `.sqlite` nüsxəsini yeni boş `data` qovluğunda `meyar.sqlite` adı ilə yerləşdirin. Köhnə `-wal`/`-shm` fayllarını yeni baza ilə qarışdırmayın. Açılışdan sonra şirkət, sənəd sayları və DBC-ni yoxlayın. Avtomatik silmə və üzərinə kor-koranə yazma yoxdur.

## İnkişaf və buraxılış

`npm ci` lockfile-dakı dəqiq versiyaları quraşdırır. TypeScript strict rejimdədir. UI Vite ilə lokal statik fayllara yığılır; tətbiq uzaqdan JavaScript yükləmir. Windows yığımı buraxılışdan əvvəl hesablama, UI və Electron-un öz SQLite runtime sınaqlarını icra edir.

Bu ilkin versiyada yayımlanmış/imzalanmış yeniləmə kanalı yoxdur. İstifadəçiyə proqramda bu vəziyyət açıq göstərilir. Sonrakı mərhələdə buraxılış, imza və yeniləmədən əvvəl baza nüsxəsinin yoxlanması ayrıca qəbul sınağıdır.

## Növbəti qəbul mərhələləri

1. Real formatlar əsasında DVX/Excel sütun xəritəsi və başlanğıc qalıq köçürməsi.
2. Qaimə sətirləri, anbar miqdarı, maya dəyəri və qaytarmalar.
3. Avanslar, xarici valyuta, məzənnə fərqləri və bank üzləşməsi.
4. Rol sistemi, müqavilələr və parametrli hesab/subkonto xəritəsi.
5. Qanunvericiliklə yoxlanılmış vergi hesabatları və insan mühasibin nümunə bazası üzrə qəbul yoxlaması.
6. Windows interfeysinin real cihazda vizual qəbulu və yeniləmə/bərpa ssenarisinin tam sınağı.
