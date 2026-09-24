# v0.1.0 — yoxlama nəticəsi

## Yerli yoxlamalar

| Yoxlama                                                              | Nəticə                               |
| -------------------------------------------------------------------- | ------------------------------------ |
| TypeScript strict: renderer + əsas proses                            | Keçdi                                |
| Real SQLite ilə uçot davranışı                                       | 16/16 keçdi                          |
| React DOM + real SQLite inteqrasiyası                                | 2/2 keçdi                            |
| Excel istiqamət, tarix, qəpik, VÖEN, formula və boş şablon sınaqları | Keçdi                                |
| Vite istehsal yığımı                                                 | Keçdi                                |
| Production asılılıqlarının npm audit yoxlaması                       | 0 məlum boşluq (auditin icra anında) |

Uçot sınaqları debet/kredit bərabərliyini, mal/xidmət hesabını, subkontonu, təkrar idxalı, tam rollback-i, düzəliş/ləğv əks yazılışlarını, şirkətlərarası müdaxilənin rədd edilməsini, bağlı dövrü, açılış/son qalıqları və ehtiyat nüsxənin yenidən açılmasını yoxlayır.

UI sınaqları proqramdan şirkət yaratma, qaimə forması açıqkən kontragent yaratma, formanın saxlanması, qaimənin uçota alınması, ödənişin borcu bağlaması, DBC və şirkət dəyişərkən köhnə məlumatla əməliyyatın qarşısının alınmasını yoxlayır. Eyni vaxtda iki submit bir sənəd yaradır. Səhv subkonto formadakı məlumatları itirmədən rədd edilir.

ExcelJS-in istifadə etdiyi `uuid` paketinin auditdə görünən köhnə versiyası `11.1.1` ilə məhdudlaşdırılıb. Excel oxuma/yazma sınaqları patch-dən sonra yenidən keçib. Məhsul kodunda yalnız ExcelJS-in istifadə etdiyi uyğun `v4` API-si qalır.

## Hələ təsdiqlənməyənlər

- Yerli proqramın real brauzerdə vizual yoxlanması bu mühitdə bloklandı (`ERR_BLOCKED_BY_CLIENT`). DOM sınağı ekran, fokusun native top-layer davranışı və piksel yoxlamasının əvəzi deyil.
- Windows quraşdırıcısı və paketdəki Electron runtime-ı ayrıca GitHub Actions işində yoxlanılır. Canlı nəticə workflow səhifəsindədir.
- Rəqəmsal imza, yayımlanmış release kanalı, avtomatik yeniləmə və real Windows istifadəçi qəbul sınağı tamamlanmayıb.
- Köhnə məlumat bazasının köçürülməsi və real şirkətin paralel uçot sınağı aparılmayıb.

Bu nəticələr yalnız yuxarıdakı əhatəni təsdiqləyir; proqramın bütün nəzərdə tutulan ERP funksiyalarının hazır olması barədə iddia deyil.
