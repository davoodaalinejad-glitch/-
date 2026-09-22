# ساخت APK اندروید

این پروژه با Capacitor آماده شده است. فایل Workflow زیر در GitHub به صورت دستی یا با push به شاخه `main`/`master` اجرا می‌شود:

`.github/workflows/build-android-apk.yml`

## ساخت APK در GitHub

1. کل محتویات این پروژه را در یک repository جدید GitHub قرار دهید.
2. به تب **Actions** بروید.
3. Workflow با نام **Build Android APK** را انتخاب کنید.
4. روی **Run workflow** بزنید.
5. پس از پایان موفق، در صفحه اجرای Workflow قسمت **Artifacts** فایل `portfolio-tracker-debug-apk` را دانلود کنید.
6. فایل `app-debug.apk` را روی گوشی Android نصب کنید.

این Workflow برای APK آزمایشی از `assembleDebug` استفاده می‌کند و برای اجرای آن نیازی به keystore شخصی ندارد.

## نکته مهم درباره قیمت‌های آنلاین

نسخه فعلی برنامه برای دریافت قیمت‌ها به endpointهای `/api/rates` و `/api/rates/test-source` در سرور Express پروژه وابسته است. Capacitor فقط بخش React/Vite را داخل APK قرار می‌دهد و سرور Express را داخل گوشی اجرا نمی‌کند.

بنابراین APK ساخته‌شده از نظر رابط کاربری و داده‌های ذخیره‌شده محلی قابل اجراست، اما بخش دریافت قیمت‌های آنلاین تا زمانی که backend روی یک سرور قابل دسترس قرار نگیرد یا منطق دریافت قیمت‌ها به روش مناسب برای موبایل منتقل نشود، ممکن است کار نکند.

این موضوع مستقل از فرآیند ساخت APK است و در مرحله بعد می‌توان backend را برای نسخه موبایل اصلاح کرد.
