# Nomenklatura və anbar uçotu

Nomenklatura kartı məhsulu və ilkin uçot hesabını müəyyən edir. Qaimə sətrində hesab kodu ayrıca seçilir: 205, 201 və ya 113. Kartdakı hesab başlanğıc seçimdir; sətrin hesabı faktiki yazılışı müəyyən edir.

| Hadisə                            | Debet                | Kredit                         |
| --------------------------------- | -------------------- | ------------------------------ |
| Mal alışı                         | 205, alış ƏDV-si 241 | 531                            |
| Material alışı                    | 201, alış ƏDV-si 241 | 531                            |
| Əsas vəsait alışı                 | 113, alış ƏDV-si 241 | 531                            |
| Əsas vəsaitin istismara verilməsi | 111                  | 113                            |
| Materialın inzibati istifadəsi    | 721, xərc subkontosu | 201                            |
| Mal satışı                        | 211                  | 601, satış ƏDV-si 545          |
| Satılan malın maya dəyəri         | 701                  | 205 (material satışı üçün 201) |

Hesab adları və 111/113/201 təsnifatı: https://frameworks.e-qanun.az/34/ha_34909.html
721 əməliyyatı yalnız inzibati material istifadəsini əhatə edir; istehsal məsrəflərinin uçotu ayrıca modul tələb edir.
İnventar kartının saxlanılması amortizasiya hesablanması demək deyil.

## Dəqiqlik və ardıcıllıq

Miqdar və çevirmə əmsalı 6, vahid qiyməti 4 onluq rəqəmlə qəbul olunur. Tam ədəd və BigInt hesablamaları istifadə edilir. Sətir məbləği qəpiyə yuvarlaqlaşdırılır; ƏDV sənəddən ayrıca daxil edilir, 18% düyməsi hər sətrin vergisini ayrıca hesablayır. Anbar əsas vahidlə saxlanılır.

Satış və material istifadəsi hər şirkət / məhsul / anbar / kateqoriya üzrə cari orta çəkili maya dəyəri ilə işlənir. Mənfi qalıq və çıxışlardan əvvəlki tarixə sonradan alış daxil etmək qadağandır. Sonrakı aktiv hərəkətlər maya dəyərinə təsir etdikdə əvvəl həmin çıxışlar ləğv edilməlidir. Tam çıxış qalan bütün dəyəri götürür.

Hər inventar kartı bir əsas vahiddir; yalnız tam ədəd, dəst və cüt qəbul edilir. Sətir üzrə ən çox 1000 kart yaradılır. Qəpik qalığı kartlar arasında deterministik bölünür. İstismara vermə alışdakı konkret inventar dəyərini 113-dən 111-ə keçirir.

## Məlumat bütövlüyü

Store bütün mutasiyaları tək SQLite tranzaksiyasında aparır. Qaimə, anbar hərəkətləri, jurnal, inventar kartları və audit birlikdə tamamlanır və ya geri qaytarılır. Təkrar eyni qaimə və istifadə sənədi əlavə hərəkət yaratmır. Qaimə düzəlişi əvvəlki versiyanı əks yazılışla bağlayır; dəyişdirilmiş köhnə forma versiyası rədd edilir.

Anbar hərəkətləri silinmir və dəyişdirilmir. Şirkət, bağlı dövr və istifadə olunan vahidlər və çevirmə əmsalı üçün verilənlər bazası məhdudiyyətləri var. Nomenklaturalı sənədi Excel cəmləri ilə əvəz etmək qadağandır.

## Keçid və sərhədlər

Sxem 2-dən 3-ə keçir; mövcud şirkətlərə Əsas anbar və vahid kitabçası əlavə edilir. Tarixi məbləğ qaimələrinin anbar miqdarı təxmin edilmir. Köhnə qaimələr sətirlər əlavə edilənədək yalnız maliyyə uçotundadır.

Avtomatik amortizasiya, anbarlararası transfer, qaytarma sənədləri, partiya/seriya uçotu və valyuta hesablamaları bu dəyişikliyin əhatəsində deyil. Əsas vəsait reyestri cari vəziyyəti, anbar qalıqları isə seçilən son tarixə vəziyyəti göstərir.

## Yoxlama

tests/inventory.test.ts: dəqiqlik, qarışıq alış, qablaşdırma, orta maya dəyəri, atomik geri qaytarma, ləğv/düzəliş, inventar/istismar, şirkət və dövr sərhədləri, miqrasiya və ehtiyat nüsxə.
tests/ui.test.tsx: qaimədən nomenklatura yaratmaq, iki kateqoriyalı alış, avtomatik məbləğ/ƏDV və anbar görünüşü.
scripts/electron-layout-smoke.cjs: həqiqi Windows Electron pəncərəsində məhsul sətirləri, qablaşdırma, uçot, bir OS pəncərəsi və 7:93 sahə.

## Uçot hesabı və Dt/Kt — 0.2.2

Yeni qaimə sətirləri rəqəmli hesab kodunu JSON daxilində saxlayır. Daxili kateqoriya mövcud anbar registrləri ilə uyğunluq üçün qalır; hesab və kateqoriya uyğunsuzluğu bütöv tranzaksiyanı rədd edir. Nomenklatura kartının hesabı mövcud kateqoriyadan birqiymətli alınır. Köhnə sətirlərdə hesab yoxdursa, eyni xəritə tətbiq olunur. Müqayisə zamanı normallaşdırma eyni sənədin yenidən keçirilməsinin qarşısını alır; tarixi jurnallar dəyişdirilmir.

`invoice.postings` yalnız şirkət və sənəd ID-si üzrə faktiki jurnal sətirlərini oxuyur; hesabat tarix/account filtri və eyni nömrəli başqa qaimə nəticəyə qarışmır. Oxu audit və məlumat yenilənməsi bildirişi yaratmır. T-hesab saldosu yalnız həmin sənədin seçilmiş yazılışlarına aiddir, bütün hesabın qalığı deyil. Saxlanmamış forma dəyişiklikləri faktiki yazılışlara daxil edilmir. Alışın ilkin baxışı ayrıca işarələnir; satışın maya dəyəri saxlamada hesablanır və faktiki Dt/Kt görünüşündə açılır.

1C mənbələri:

- Azərbaycan lokalizasiyası: https://v8.1c.ru/static/1s-bukhgalteriya-8-dlya-azerbaydzhana/
- Nomenklatura üzrə uçot hesabının avtomatik və əl ilə seçilməsi (mexanizmin izahı): https://buh.ru/articles/sposoby-postupleniya-mpz-formirovanie-ikh-fakticheskoy-sebestoimosti-v-1s-bukhgalterii-8.html
- Hesab təhlili, hesab kartları və standart hesabatlar: https://v8.1c.ru/buhv8/ch/

Azərbaycan hesab kodları tətbiq olunur; Rusiya konfiqurasiyasının 10/41/60 hesabları köçürülmür. Bu dəyişiklik 1C-nin tam funksional surəti deyil. Dəstəklənən ehtiyat hesabları 201/205/113-dür; ixtiyari subhesab yaratmaq və əl ilə jurnal redaktəsi əlavə edilməyib.

Əlavə yoxlamalar: hesab seçiminin real 201 yazılışına təsiri, hesab/kateqoriya uyğunsuzluğunda atomik rədd, şirkət/sənəd sərhədləri, düzəliş və ləğv tarixçəsi, ödənilmiş və bağlı dövrdə köhnə qaimənin təkrarsız saxlanılması, T-hesab görünüşü və formanın qaralamasının saxlanması. Windows testi Dt/Kt pəncərəsinin əsas OS pəncərəsi daxilində açılmasını da yoxlayır.
