# Nomenklatura və anbar uçotu

Nomenklatura kartı məhsulu müəyyən edir. Alış sətirindəki istifadə məqsədi uçot kateqoriyasını müəyyən edir; kartdakı kateqoriya yalnız başlanğıc seçimdir.

| Hadisə | Debet | Kredit |
|---|---|---|
| Mal alışı | 205, alış ƏDV-si 241 | 531 |
| Material alışı | 201, alış ƏDV-si 241 | 531 |
| Əsas vəsait alışı | 113, alış ƏDV-si 241 | 531 |
| Əsas vəsaitin istismara verilməsi | 111 | 113 |
| Materialın inzibati istifadəsi | 721, xərc subkontosu | 201 |
| Mal satışı | 211 | 601, satış ƏDV-si 545 |
| Satılan malın maya dəyəri | 701 | 205 (material satışı üçün 201) |

Hesab adları və 111/113/201 təsnifatı: https://frameworks.e-qanun.az/34/ha_34909.html
721 əməliyyatı yalnız inzibati material istifadəsini əhatə edir; istehsal məsrəflərinin uçotu ayrıca modul tələb edir.
İnventar kartının saxlanılması amortizasiya hesablanması demək deyil.

## Dəqiqlik və ardıcıllıq

Miqdar və çevirmə əmsalı 6, vahid qiyməti 4 onluq rəqəmlə qəbul olunur. Tam ədəd və BigInt hesablamaları istifadə edilir. Sətir məbləği qəpiyə yuvarlaqlaşdırılır; ƏDV sənəddən ayrıca daxil edilir, 18% düyməsi hər sətrin vergisini ayrıca hesablayır. Anbar əsas vahidlə saxlanılır.

Satış və material istifadəsi hər şirkət / məhsul / anbar / kateqoriya üzrə cari orta çəkili maya dəyəri ilə işlənir. Mənfi qalıq və çıxışlardan əvvəlki tarixə sonradan alış daxil etmək qadağandır. Sonrakı aktiv hərəkətlər maya dəyərinə təsir etdikdə əvvəl həmin çıxışlar ləğv edilməlidir. Tam çıxış qalan bütün dəyəri götürür.

Hər inventar kartı bir əsas vahiddir; yalnız tam ədəd, dəst və cüt qəbul edilir. Sətir üzrə ən çox 1000 kart yaradılır. Qəpik qalığı kartlar arasında deterministik bölünür. İstismara vermə alışdakı konkret inventar dəyərini 113-dən 111-ə keçirir.

## Məlumat bütövlüyü

Store bütün mutasiyaları tək SQLite tranzaksiyasında aparır. Qaimə, anbar hərəkətləri, jurnal, inventar kartları və audit birlikdə tamamlanır və ya geri qaytarılır. Təkrar eyni qaimə və istifadə sənədi əlavə hərəkət yaratmır. Qaimə düzəlişi əvvəlki versiyanı əks yazılışla bağlayır; dəyişdirilmiş köhnə forma versiyası rədd edilir.

Anbar hərəkətləri silinmir və dəyişdirilmir. Şirkət, bağlı dövr və istifadə olunan əsas vahid üçün verilənlər bazası məhdudiyyətləri var. Nomenklaturalı sənədi Excel cəmləri ilə əvəz etmək qadağandır.

## Keçid və sərhədlər

Sxem 2-dən 3-ə keçir; mövcud şirkətlərə Əsas anbar və vahid kitabçası əlavə edilir. Tarixi məbləğ qaimələrinin anbar miqdarı təxmin edilmir. Köhnə qaimələr sətirlər əlavə edilənədək yalnız maliyyə uçotundadır.

Avtomatik amortizasiya, anbarlararası transfer, qaytarma sənədləri, partiya/seriya uçotu və valyuta hesablamaları bu dəyişikliyin əhatəsində deyil. Əsas vəsait reyestri cari vəziyyəti, anbar qalıqları isə seçilən son tarixə vəziyyəti göstərir.

## Yoxlama

tests/inventory.test.ts: dəqiqlik, qarışıq alış, qablaşdırma, orta maya dəyəri, atomik geri qaytarma, ləğv/düzəliş, inventar/istismar, şirkət və dövr sərhədləri, miqrasiya və ehtiyat nüsxə.
tests/ui.test.tsx: qaimədən nomenklatura yaratmaq, iki kateqoriyalı alış, avtomatik məbləğ/ƏDV və anbar görünüşü.
scripts/electron-layout-smoke.cjs: həqiqi Windows Electron pəncərəsində məhsul sətirləri, qablaşdırma, uçot, bir OS pəncərəsi və 7:93 sahə.
