# whatsapp_i18n.py
# Internationalization for WhatsApp messages in Bill-e
# Supports: ES, EN, PT, ZH, HI, FR, RU, JA, DE, ID

from typing import Dict, Optional

# Country code prefixes mapped to languages
# Based on most common language in each country
COUNTRY_CODE_TO_LANG: Dict[str, str] = {
    # Spanish
    "34": "es",   # Spain
    "52": "es",   # Mexico
    "54": "es",   # Argentina
    "56": "es",   # Chile
    "57": "es",   # Colombia
    "51": "es",   # Peru
    "58": "es",   # Venezuela
    "593": "es",  # Ecuador
    "591": "es",  # Bolivia
    "595": "es",  # Paraguay
    "598": "es",  # Uruguay
    "506": "es",  # Costa Rica
    "507": "es",  # Panama
    "503": "es",  # El Salvador
    "502": "es",  # Guatemala
    "504": "es",  # Honduras
    "505": "es",  # Nicaragua
    "53": "es",   # Cuba
    "1809": "es", # Dominican Republic
    "1829": "es", # Dominican Republic
    "1849": "es", # Dominican Republic

    # English
    "1": "en",    # USA/Canada (default for +1)
    "44": "en",   # UK
    "61": "en",   # Australia
    "64": "en",   # New Zealand
    "27": "en",   # South Africa
    "353": "en",  # Ireland
    "65": "en",   # Singapore
    "63": "en",   # Philippines

    # Portuguese
    "55": "pt",   # Brazil
    "351": "pt",  # Portugal

    # Chinese
    "86": "zh",   # China
    "852": "zh",  # Hong Kong
    "853": "zh",  # Macau
    "886": "zh",  # Taiwan

    # Hindi
    "91": "hi",   # India

    # French
    "33": "fr",   # France
    "32": "fr",   # Belgium
    "41": "fr",   # Switzerland (multilingual, default FR)
    "1242": "fr", # Haiti area
    "509": "fr",  # Haiti

    # Russian
    "7": "ru",    # Russia/Kazakhstan
    "375": "ru",  # Belarus
    "380": "ru",  # Ukraine (Russian widely spoken)

    # Japanese
    "81": "ja",   # Japan

    # German
    "49": "de",   # Germany
    "43": "de",   # Austria

    # Indonesian
    "62": "id",   # Indonesia

    # Arabic
    "966": "ar",  # Saudi Arabia
    "971": "ar",  # UAE
    "20": "ar",   # Egypt
    "212": "ar",  # Morocco
    "213": "ar",  # Algeria
    "216": "ar",  # Tunisia
    "218": "ar",  # Libya
    "962": "ar",  # Jordan
    "961": "ar",  # Lebanon
    "963": "ar",  # Syria
    "964": "ar",  # Iraq
    "965": "ar",  # Kuwait
    "968": "ar",  # Oman
    "970": "ar",  # Palestine
    "973": "ar",  # Bahrain
    "974": "ar",  # Qatar
    "967": "ar",  # Yemen
    "249": "ar",  # Sudan

    # Bengali
    "880": "bn",  # Bangladesh
}

# Default language if country code not found
DEFAULT_LANG = "en"


def detect_language(phone_number: str) -> str:
    """
    Detect language from phone number country code.

    Args:
        phone_number: Phone number with country code (e.g., "56912345678")

    Returns:
        Language code (es, en, pt, zh, hi, fr, ru, ja, de, id)
    """
    # Clean phone number
    phone = phone_number.replace("+", "").replace(" ", "").replace("-", "")

    # Try matching from longest prefix to shortest
    # This handles cases like 1809 (Dominican) vs 1 (USA)
    for prefix_len in [4, 3, 2, 1]:
        if len(phone) >= prefix_len:
            prefix = phone[:prefix_len]
            if prefix in COUNTRY_CODE_TO_LANG:
                return COUNTRY_CODE_TO_LANG[prefix]

    return DEFAULT_LANG


# =============================================================================
# TRANSLATIONS
# =============================================================================

TRANSLATIONS: Dict[str, Dict[str, str]] = {
    # -------------------------------------------------------------------------
    # Processing messages
    # -------------------------------------------------------------------------
    "processing": {
        "es": "Estoy procesando tu boleta...",
        "en": "Processing your receipt...",
        "pt": "Processando seu recibo...",
        "zh": "正在处理您的收据...",
        "hi": "आपकी रसीद प्रोसेस हो रही है...",
        "fr": "Je traite votre addition...",
        "ar": "جاري معالجة الفاتورة...",
        "bn": "তোমার রসিদ প্রসেস হচ্ছে...",
        "ru": "Обрабатываю ваш чек...",
        "ja": "レシートを処理中...",
        "de": "Verarbeite deine Rechnung...",
        "id": "Memproses struk kamu...",
    },

    "error_no_image": {
        "es": "No pude obtener la imagen. Intenta de nuevo.",
        "en": "Couldn't get the image. Please try again.",
        "pt": "Nao consegui obter a imagem. Tente novamente.",
        "zh": "无法获取图片，请重试。",
        "hi": "इमेज नहीं मिली। फिर से कोशिश करें।",
        "fr": "Impossible d'obtenir l'image. Reessayez.",
        "ar": "تعذر الحصول على الصورة. حاول مرة أخرى.",
        "bn": "ছবি পাওয়া যায়নি। আবার চেষ্টা করো।",
        "ru": "Не удалось получить изображение. Попробуйте снова.",
        "ja": "画像を取得できませんでした。もう一度お試しください。",
        "de": "Konnte das Bild nicht laden. Bitte erneut versuchen.",
        "id": "Gagal mendapatkan gambar. Coba lagi.",
    },

    "error_download": {
        "es": "No pude descargar la imagen.",
        "en": "Couldn't download the image.",
        "pt": "Nao consegui baixar a imagem.",
        "zh": "无法下载图片。",
        "hi": "इमेज डाउनलोड नहीं हो पाई।",
        "fr": "Impossible de telecharger l'image.",
        "ar": "تعذر تنزيل الصورة.",
        "bn": "ছবি ডাউনলোড হয়নি।",
        "ru": "Не удалось скачать изображение.",
        "ja": "画像をダウンロードできませんでした。",
        "de": "Konnte das Bild nicht herunterladen.",
        "id": "Gagal mengunduh gambar.",
    },

    "error_ocr": {
        "es": "Error al procesar la boleta: {error}\n\nPor favor intenta con una foto mas clara.",
        "en": "Error processing receipt: {error}\n\nPlease try with a clearer photo.",
        "pt": "Erro ao processar o recibo: {error}\n\nTente com uma foto mais clara.",
        "zh": "处理收据时出错：{error}\n\n请尝试拍摄更清晰的照片。",
        "hi": "रसीद प्रोसेस करने में त्रुटि: {error}\n\nकृपया साफ फोटो से फिर कोशिश करें।",
        "fr": "Erreur lors du traitement: {error}\n\nEssayez avec une photo plus nette.",
        "ar": "خطأ في معالجة الفاتورة: {error}\n\nحاول بصورة أوضح.",
        "bn": "রসিদ প্রসেস করতে সমস্যা: {error}\n\nআরো পরিষ্কার ছবি দিয়ে চেষ্টা করো।",
        "ru": "Ошибка обработки чека: {error}\n\nПопробуйте сфотографировать четче.",
        "ja": "レシート処理エラー：{error}\n\nより鮮明な写真でお試しください。",
        "de": "Fehler bei der Verarbeitung: {error}\n\nBitte mit einem klareren Foto versuchen.",
        "id": "Error memproses struk: {error}\n\nCoba dengan foto yang lebih jelas.",
    },

    "error_general": {
        "es": "Ocurrio un error. Por favor intenta de nuevo.",
        "en": "An error occurred. Please try again.",
        "pt": "Ocorreu um erro. Tente novamente.",
        "zh": "发生错误，请重试。",
        "hi": "कोई त्रुटि हुई। फिर से कोशिश करें।",
        "fr": "Une erreur est survenue. Reessayez.",
        "ar": "حدث خطأ. حاول مرة أخرى.",
        "bn": "একটা সমস্যা হয়েছে। আবার চেষ্টা করো।",
        "ru": "Произошла ошибка. Попробуйте снова.",
        "ja": "エラーが発生しました。もう一度お試しください。",
        "de": "Ein Fehler ist aufgetreten. Bitte erneut versuchen.",
        "id": "Terjadi kesalahan. Coba lagi.",
    },

    # -------------------------------------------------------------------------
    # Welcome message
    # -------------------------------------------------------------------------
    "welcome": {
        "es": (
            "Hola! Soy Bill-e, tu asistente para dividir cuentas.\n\n"
            "*Para empezar:*\n"
            "1. Toma una foto clara de tu boleta\n"
            "2. Enviamela por este chat\n"
            "3. Te creare un link para dividir automaticamente\n\n"
            "Escribe 'ayuda' para mas informacion."
        ),
        "en": (
            "Hi! I'm Bill-e, your bill-splitting assistant.\n\n"
            "*To get started:*\n"
            "1. Take a clear photo of your receipt\n"
            "2. Send it to me here\n"
            "3. I'll create a link to split it automatically\n\n"
            "Type 'help' for more info."
        ),
        "pt": (
            "Oi! Sou o Bill-e, seu assistente para dividir contas.\n\n"
            "*Para comecar:*\n"
            "1. Tire uma foto clara do seu recibo\n"
            "2. Envie aqui no chat\n"
            "3. Vou criar um link para dividir automaticamente\n\n"
            "Digite 'ajuda' para mais informacoes."
        ),
        "zh": (
            "你好！我是Bill-e，你的账单分摊助手。\n\n"
            "*开始使用：*\n"
            "1. 拍一张清晰的收据照片\n"
            "2. 发送给我\n"
            "3. 我会创建一个自动分账的链接\n\n"
            "输入'帮助'获取更多信息。"
        ),
        "hi": (
            "नमस्ते! मैं Bill-e हूं, बिल बांटने में आपका सहायक।\n\n"
            "*शुरू करने के लिए:*\n"
            "1. अपनी रसीद की साफ फोटो लें\n"
            "2. मुझे यहां भेजें\n"
            "3. मैं ऑटो-स्प्लिट लिंक बना दूंगा\n\n"
            "'मदद' टाइप करें अधिक जानकारी के लिए।"
        ),
        "fr": (
            "Salut! Je suis Bill-e, ton assistant pour partager l'addition.\n\n"
            "*Pour commencer:*\n"
            "1. Prends une photo claire de ton ticket\n"
            "2. Envoie-la ici\n"
            "3. Je creerai un lien pour partager automatiquement\n\n"
            "Ecris 'aide' pour plus d'infos."
        ),
        "ar": (
            "أهلاً! أنا Bill-e، مساعدك لتقسيم الفاتورة.\n\n"
            "*للبدء:*\n"
            "1. صوّر الفاتورة بوضوح\n"
            "2. أرسلها لي هنا\n"
            "3. سأنشئ رابط للتقسيم تلقائياً\n\n"
            "اكتب 'مساعدة' لمزيد من المعلومات."
        ),
        "bn": (
            "হাই! আমি Bill-e, বিল ভাগ করার সহকারী।\n\n"
            "*শুরু করতে:*\n"
            "1. রসিদের পরিষ্কার ছবি তোলো\n"
            "2. এখানে পাঠাও\n"
            "3. অটো ভাগ করার লিংক বানিয়ে দেব\n\n"
            "'সাহায্য' লিখো বিস্তারিত জানতে।"
        ),
        "ru": (
            "Привет! Я Bill-e, помощник для разделения счетов.\n\n"
            "*Чтобы начать:*\n"
            "1. Сфотографируй чек четко\n"
            "2. Отправь мне сюда\n"
            "3. Я создам ссылку для автоматического разделения\n\n"
            "Напиши 'помощь' для подробностей."
        ),
        "ja": (
            "こんにちは！Bill-eです。割り勘のお手伝いをします。\n\n"
            "*使い方:*\n"
            "1. レシートの写真を撮る\n"
            "2. ここに送信\n"
            "3. 自動で割り勘リンクを作成します\n\n"
            "「ヘルプ」と入力で詳細表示。"
        ),
        "de": (
            "Hi! Ich bin Bill-e, dein Assistent zum Rechnung teilen.\n\n"
            "*So geht's:*\n"
            "1. Mach ein klares Foto von der Rechnung\n"
            "2. Schick es mir hier\n"
            "3. Ich erstelle einen Link zum automatischen Teilen\n\n"
            "Schreib 'hilfe' fuer mehr Infos."
        ),
        "id": (
            "Hai! Aku Bill-e, asisten untuk bagi-bagi tagihan.\n\n"
            "*Cara pakai:*\n"
            "1. Foto struk dengan jelas\n"
            "2. Kirim ke sini\n"
            "3. Aku buatkan link untuk bagi otomatis\n\n"
            "Ketik 'bantuan' untuk info lebih lanjut."
        ),
    },

    # -------------------------------------------------------------------------
    # Help message
    # -------------------------------------------------------------------------
    "help": {
        "es": (
            "*Como usar Bill-e:*\n\n"
            "1. Toma una foto de tu boleta de restaurante\n"
            "2. Enviamela por WhatsApp\n"
            "3. Procesare automaticamente los items y precios\n"
            "4. Te dare un link para dividir la cuenta\n"
            "5. Comparte el link con tus amigos!\n\n"
            "*Tips para mejores resultados:*\n"
            "- Asegurate de que la boleta este bien iluminada\n"
            "- Que se vean claramente los precios y nombres\n"
            "- Evita sombras o reflejos\n\n"
            "Listo? Envia tu boleta!"
        ),
        "en": (
            "*How to use Bill-e:*\n\n"
            "1. Take a photo of your restaurant receipt\n"
            "2. Send it to me on WhatsApp\n"
            "3. I'll automatically process items and prices\n"
            "4. You'll get a link to split the bill\n"
            "5. Share the link with your friends!\n\n"
            "*Tips for best results:*\n"
            "- Make sure the receipt is well lit\n"
            "- Prices and names should be clearly visible\n"
            "- Avoid shadows or reflections\n\n"
            "Ready? Send your receipt!"
        ),
        "pt": (
            "*Como usar o Bill-e:*\n\n"
            "1. Tire uma foto do seu recibo do restaurante\n"
            "2. Envie aqui no WhatsApp\n"
            "3. Vou processar os itens e precos automaticamente\n"
            "4. Voce recebera um link para dividir a conta\n"
            "5. Compartilhe o link com seus amigos!\n\n"
            "*Dicas para melhores resultados:*\n"
            "- Certifique-se de que o recibo esteja bem iluminado\n"
            "- Precos e nomes devem estar claros\n"
            "- Evite sombras ou reflexos\n\n"
            "Pronto? Envie seu recibo!"
        ),
        "zh": (
            "*如何使用Bill-e：*\n\n"
            "1. 拍摄餐厅收据照片\n"
            "2. 通过WhatsApp发送给我\n"
            "3. 我会自动处理菜品和价格\n"
            "4. 你会收到一个分账链接\n"
            "5. 分享给朋友们！\n\n"
            "*小贴士：*\n"
            "- 确保收据光线充足\n"
            "- 价格和名称要清晰可见\n"
            "- 避免阴影或反光\n\n"
            "准备好了？发送收据吧！"
        ),
        "hi": (
            "*Bill-e कैसे इस्तेमाल करें:*\n\n"
            "1. रेस्टोरेंट बिल की फोटो लें\n"
            "2. WhatsApp पर मुझे भेजें\n"
            "3. मैं आइटम और प्राइस ऑटो प्रोसेस करूंगा\n"
            "4. बिल बांटने का लिंक मिलेगा\n"
            "5. दोस्तों के साथ शेयर करें!\n\n"
            "*बेहतर रिजल्ट के लिए:*\n"
            "- बिल पर अच्छी रोशनी हो\n"
            "- प्राइस और नाम साफ दिखें\n"
            "- छाया या रिफ्लेक्शन न हो\n\n"
            "तैयार? बिल भेजें!"
        ),
        "fr": (
            "*Comment utiliser Bill-e:*\n\n"
            "1. Prends une photo de ton ticket de resto\n"
            "2. Envoie-la moi sur WhatsApp\n"
            "3. Je traiterai les articles et prix automatiquement\n"
            "4. Tu recevras un lien pour partager l'addition\n"
            "5. Partage le lien avec tes amis!\n\n"
            "*Conseils pour de meilleurs resultats:*\n"
            "- Assure-toi que le ticket est bien eclaire\n"
            "- Les prix et noms doivent etre visibles\n"
            "- Evite les ombres ou reflets\n\n"
            "Pret? Envoie ton ticket!"
        ),
        "ar": (
            "*كيفية استخدام Bill-e:*\n\n"
            "1. صوّر فاتورة المطعم\n"
            "2. أرسلها لي على واتساب\n"
            "3. سأعالج الأصناف والأسعار تلقائياً\n"
            "4. ستحصل على رابط لتقسيم الفاتورة\n"
            "5. شارك الرابط مع أصدقائك!\n\n"
            "*نصائح لنتائج أفضل:*\n"
            "- تأكد من إضاءة الفاتورة جيداً\n"
            "- الأسعار والأسماء واضحة\n"
            "- تجنب الظلال والانعكاسات\n\n"
            "جاهز؟ أرسل الفاتورة!"
        ),
        "bn": (
            "*Bill-e কিভাবে ব্যবহার করবে:*\n\n"
            "1. রেস্টুরেন্টের রসিদের ছবি তোলো\n"
            "2. WhatsApp-এ আমাকে পাঠাও\n"
            "3. আইটেম আর দাম অটো প্রসেস করব\n"
            "4. বিল ভাগ করার লিংক পাবে\n"
            "5. বন্ধুদের সাথে শেয়ার করো!\n\n"
            "*ভালো রেজাল্টের জন্য:*\n"
            "- রসিদে ভালো আলো থাকুক\n"
            "- দাম আর নাম পরিষ্কার দেখাক\n"
            "- ছায়া বা প্রতিফলন এড়াও\n\n"
            "রেডি? রসিদ পাঠাও!"
        ),
        "ru": (
            "*Как пользоваться Bill-e:*\n\n"
            "1. Сфотографируй чек из ресторана\n"
            "2. Отправь мне в WhatsApp\n"
            "3. Я автоматически обработаю позиции и цены\n"
            "4. Получишь ссылку для разделения счета\n"
            "5. Поделись ссылкой с друзьями!\n\n"
            "*Советы для лучших результатов:*\n"
            "- Чек должен быть хорошо освещен\n"
            "- Цены и названия должны быть четкими\n"
            "- Избегай теней и бликов\n\n"
            "Готов? Отправляй чек!"
        ),
        "ja": (
            "*Bill-eの使い方:*\n\n"
            "1. レストランのレシートを撮影\n"
            "2. WhatsAppで送信\n"
            "3. 自動で品目と価格を処理\n"
            "4. 割り勘用リンクをお届け\n"
            "5. 友達とシェア！\n\n"
            "*きれいに読み取るコツ:*\n"
            "- レシートを明るい場所で撮影\n"
            "- 価格と品名がはっきり見えるように\n"
            "- 影や反射を避ける\n\n"
            "準備OK？レシートを送ってね！"
        ),
        "de": (
            "*So verwendest du Bill-e:*\n\n"
            "1. Mach ein Foto von deiner Restaurant-Rechnung\n"
            "2. Schick es mir auf WhatsApp\n"
            "3. Ich verarbeite Artikel und Preise automatisch\n"
            "4. Du bekommst einen Link zum Teilen\n"
            "5. Teile den Link mit deinen Freunden!\n\n"
            "*Tipps fuer beste Ergebnisse:*\n"
            "- Die Rechnung sollte gut beleuchtet sein\n"
            "- Preise und Namen muessen klar sichtbar sein\n"
            "- Vermeide Schatten oder Spiegelungen\n\n"
            "Bereit? Schick deine Rechnung!"
        ),
        "id": (
            "*Cara pakai Bill-e:*\n\n"
            "1. Foto struk restoran kamu\n"
            "2. Kirim ke aku di WhatsApp\n"
            "3. Aku proses item dan harga otomatis\n"
            "4. Kamu dapat link untuk bagi tagihan\n"
            "5. Share link ke teman-teman!\n\n"
            "*Tips hasil terbaik:*\n"
            "- Pastikan struk terang\n"
            "- Harga dan nama harus jelas\n"
            "- Hindari bayangan atau pantulan\n\n"
            "Siap? Kirim strukmu!"
        ),
    },

    # -------------------------------------------------------------------------
    # Default message (when user sends unrecognized text)
    # -------------------------------------------------------------------------
    "default": {
        "es": (
            "Para dividir una cuenta, enviame una foto de tu boleta.\n\n"
            "Solo toma la foto y enviamela - yo hare el resto.\n"
            "Escribe 'ayuda' si necesitas mas informacion."
        ),
        "en": (
            "To split a bill, send me a photo of your receipt.\n\n"
            "Just take the photo and send it - I'll do the rest.\n"
            "Type 'help' if you need more info."
        ),
        "pt": (
            "Para dividir uma conta, me envie uma foto do seu recibo.\n\n"
            "So tire a foto e envie - eu faco o resto.\n"
            "Digite 'ajuda' se precisar de mais informacoes."
        ),
        "zh": (
            "要分账，请发送收据照片给我。\n\n"
            "拍照发送即可，剩下的交给我。\n"
            "输入'帮助'获取更多信息。"
        ),
        "hi": (
            "बिल बांटने के लिए, रसीद की फोटो भेजें।\n\n"
            "बस फोटो लें और भेजें - बाकी मैं करूंगा।\n"
            "'मदद' टाइप करें अगर जानकारी चाहिए।"
        ),
        "fr": (
            "Pour partager une addition, envoie-moi une photo du ticket.\n\n"
            "Prends juste la photo et envoie - je fais le reste.\n"
            "Ecris 'aide' si tu as besoin d'infos."
        ),
        "ar": (
            "لتقسيم الفاتورة، أرسل لي صورة منها.\n\n"
            "فقط صوّر وأرسل - أنا أتكفل بالباقي.\n"
            "اكتب 'مساعدة' إذا احتجت معلومات."
        ),
        "bn": (
            "বিল ভাগ করতে, রসিদের ছবি পাঠাও।\n\n"
            "শুধু ছবি তুলে পাঠাও - বাকিটা আমি করব।\n"
            "'সাহায্য' লিখো তথ্য দরকার হলে।"
        ),
        "ru": (
            "Чтобы разделить счет, отправь мне фото чека.\n\n"
            "Просто сфотографируй и отправь - остальное сделаю я.\n"
            "Напиши 'помощь' если нужна информация."
        ),
        "ja": (
            "割り勘するには、レシートの写真を送ってね。\n\n"
            "写真を撮って送るだけ。あとは私がやるよ。\n"
            "「ヘルプ」で詳細表示。"
        ),
        "de": (
            "Um eine Rechnung zu teilen, schick mir ein Foto davon.\n\n"
            "Einfach fotografieren und senden - den Rest mache ich.\n"
            "Schreib 'hilfe' wenn du mehr Infos brauchst."
        ),
        "id": (
            "Untuk bagi tagihan, kirim foto struk ke aku.\n\n"
            "Tinggal foto dan kirim - sisanya aku yang urus.\n"
            "Ketik 'bantuan' kalau butuh info."
        ),
    },

    # -------------------------------------------------------------------------
    # Document received message
    # -------------------------------------------------------------------------
    "document_received": {
        "es": (
            "Recibi tu documento: {filename}\n\n"
            "Por ahora solo puedo procesar imagenes de boletas.\n"
            "Puedes enviarme una foto de la boleta en su lugar?"
        ),
        "en": (
            "Got your document: {filename}\n\n"
            "For now I can only process receipt images.\n"
            "Can you send me a photo of the receipt instead?"
        ),
        "pt": (
            "Recebi seu documento: {filename}\n\n"
            "Por enquanto so consigo processar imagens de recibos.\n"
            "Pode me enviar uma foto do recibo?"
        ),
        "zh": (
            "收到你的文件：{filename}\n\n"
            "目前我只能处理收据图片。\n"
            "能发一张收据照片吗？"
        ),
        "hi": (
            "आपका डॉक्यूमेंट मिला: {filename}\n\n"
            "अभी मैं सिर्फ रसीद की इमेज प्रोसेस कर सकता हूं।\n"
            "क्या आप रसीद की फोटो भेज सकते हैं?"
        ),
        "fr": (
            "J'ai recu ton document: {filename}\n\n"
            "Pour l'instant je ne peux traiter que les photos de tickets.\n"
            "Tu peux m'envoyer une photo du ticket?"
        ),
        "ar": (
            "استلمت المستند: {filename}\n\n"
            "حالياً أستطيع معالجة صور الفواتير فقط.\n"
            "هل يمكنك إرسال صورة للفاتورة؟"
        ),
        "bn": (
            "তোমার ডকুমেন্ট পেলাম: {filename}\n\n"
            "এখন শুধু রসিদের ছবি প্রসেস করতে পারি।\n"
            "রসিদের ছবি পাঠাতে পারবে?"
        ),
        "ru": (
            "Получил твой документ: {filename}\n\n"
            "Пока я могу обрабатывать только фото чеков.\n"
            "Можешь отправить фото чека?"
        ),
        "ja": (
            "ドキュメントを受信：{filename}\n\n"
            "現在、レシート画像のみ処理できます。\n"
            "レシートの写真を送ってもらえますか？"
        ),
        "de": (
            "Dokument erhalten: {filename}\n\n"
            "Momentan kann ich nur Rechnungsfotos verarbeiten.\n"
            "Kannst du mir ein Foto der Rechnung schicken?"
        ),
        "id": (
            "Dokumen diterima: {filename}\n\n"
            "Saat ini aku hanya bisa proses foto struk.\n"
            "Bisa kirim foto struknya?"
        ),
    },

    # -------------------------------------------------------------------------
    # Collaborative session message (main result)
    # -------------------------------------------------------------------------
    "session_verified": {
        "es": "Totales verificados",
        "en": "Totals verified",
        "pt": "Totais verificados",
        "zh": "金额已验证",
        "hi": "कुल राशि सत्यापित",
        "fr": "Totaux verifies",
        "ar": "تم التحقق من المجاميع",
        "bn": "মোট যাচাই হয়েছে",
        "ru": "Суммы проверены",
        "ja": "合計確認済み",
        "de": "Betraege verifiziert",
        "id": "Total terverifikasi",
    },

    "session_review": {
        "es": "Revisar totales",
        "en": "Review totals",
        "pt": "Verificar totais",
        "zh": "请核对金额",
        "hi": "कुल राशि जांचें",
        "fr": "Verifier les totaux",
        "ar": "راجع المجاميع",
        "bn": "মোট চেক করো",
        "ru": "Проверьте суммы",
        "ja": "金額を確認",
        "de": "Betraege pruefen",
        "id": "Periksa total",
    },

    "session_total": {
        "es": "Total",
        "en": "Total",
        "pt": "Total",
        "zh": "总计",
        "hi": "कुल",
        "fr": "Total",
        "ar": "المجموع",
        "bn": "মোট",
        "ru": "Итого",
        "ja": "合計",
        "de": "Gesamt",
        "id": "Total",
    },

    "session_subtotal": {
        "es": "Subtotal",
        "en": "Subtotal",
        "pt": "Subtotal",
        "zh": "小计",
        "hi": "उप-योग",
        "fr": "Sous-total",
        "ar": "المجموع الفرعي",
        "bn": "সাবটোটাল",
        "ru": "Подытог",
        "ja": "小計",
        "de": "Zwischensumme",
        "id": "Subtotal",
    },

    "session_tip": {
        "es": "Propina",
        "en": "Tip",
        "pt": "Gorjeta",
        "zh": "小费",
        "hi": "टिप",
        "fr": "Pourboire",
        "ar": "بقشيش",
        "bn": "টিপ",
        "ru": "Чаевые",
        "ja": "チップ",
        "de": "Trinkgeld",
        "id": "Tip",
    },

    "session_items": {
        "es": "Items",
        "en": "Items",
        "pt": "Itens",
        "zh": "项目",
        "hi": "आइटम",
        "fr": "Articles",
        "ar": "الأصناف",
        "bn": "আইটেম",
        "ru": "Позиции",
        "ja": "品目",
        "de": "Artikel",
        "id": "Item",
    },

    "session_host_link": {
        "es": "Tu link de anfitrion (guardalo)",
        "en": "Your host link (save it)",
        "pt": "Seu link de anfitriao (guarde)",
        "zh": "你的主持人链接（请保存）",
        "hi": "आपका होस्ट लिंक (सेव करें)",
        "fr": "Ton lien d'hote (garde-le)",
        "ar": "رابط المضيف (احفظه)",
        "bn": "তোমার হোস্ট লিংক (সেভ করো)",
        "ru": "Твоя ссылка хозяина (сохрани)",
        "ja": "ホストリンク（保存してね）",
        "de": "Dein Host-Link (speichern)",
        "id": "Link host kamu (simpan)",
    },

    "session_host_instruction": {
        "es": "Usa este link para ver los totales y finalizar",
        "en": "Use this link to view totals and finalize",
        "pt": "Use este link para ver totais e finalizar",
        "zh": "用此链接查看金额并完成",
        "hi": "कुल देखने और पूरा करने के लिए इस लिंक का उपयोग करें",
        "fr": "Utilise ce lien pour voir les totaux et finaliser",
        "ar": "استخدم هذا الرابط لعرض المجاميع والإنهاء",
        "bn": "মোট দেখতে ও শেষ করতে এই লিংক ব্যবহার করো",
        "ru": "Используй эту ссылку для просмотра сумм и завершения",
        "ja": "このリンクで合計確認と完了",
        "de": "Nutze diesen Link zum Ansehen und Abschliessen",
        "id": "Pakai link ini untuk lihat total dan selesaikan",
    },

    "session_share_link": {
        "es": "Link para compartir con tus amigos",
        "en": "Link to share with your friends",
        "pt": "Link para compartilhar com amigos",
        "zh": "分享给朋友的链接",
        "hi": "दोस्तों के साथ शेयर करने का लिंक",
        "fr": "Lien a partager avec tes amis",
        "ar": "رابط للمشاركة مع أصدقائك",
        "bn": "বন্ধুদের সাথে শেয়ার করার লিংক",
        "ru": "Ссылка для друзей",
        "ja": "友達に共有するリンク",
        "de": "Link zum Teilen mit Freunden",
        "id": "Link untuk dibagikan ke teman",
    },

    "session_share_instruction": {
        "es": "Copia y envia este link al grupo",
        "en": "Copy and send this link to the group",
        "pt": "Copie e envie este link ao grupo",
        "zh": "复制此链接发送到群组",
        "hi": "इस लिंक को ग्रुप में कॉपी और भेजें",
        "fr": "Copie et envoie ce lien au groupe",
        "ar": "انسخ وأرسل هذا الرابط للمجموعة",
        "bn": "এই লিংক কপি করে গ্রুপে পাঠাও",
        "ru": "Скопируй и отправь эту ссылку в группу",
        "ja": "このリンクをグループに送信",
        "de": "Kopiere und sende diesen Link an die Gruppe",
        "id": "Salin dan kirim link ini ke grup",
    },

    "session_expires": {
        "es": "La sesion expira en 24 horas",
        "en": "Session expires in 24 hours",
        "pt": "A sessao expira em 24 horas",
        "zh": "会话24小时后过期",
        "hi": "सेशन 24 घंटे में समाप्त होगा",
        "fr": "La session expire dans 24 heures",
        "ar": "تنتهي الجلسة خلال 24 ساعة",
        "bn": "সেশন ২৪ ঘন্টায় শেষ হবে",
        "ru": "Сессия истекает через 24 часа",
        "ja": "セッションは24時間で期限切れ",
        "de": "Sitzung laeuft in 24 Stunden ab",
        "id": "Sesi berakhir dalam 24 jam",
    },

    "receipt_processed": {
        "es": "Boleta procesada!",
        "en": "Receipt processed!",
        "pt": "Recibo processado!",
        "zh": "收据已处理！",
        "hi": "रसीद प्रोसेस हो गई!",
        "fr": "Ticket traite!",
        "ar": "تمت معالجة الفاتورة!",
        "bn": "রসিদ প্রসেস হয়েছে!",
        "ru": "Чек обработан!",
        "ja": "レシート処理完了！",
        "de": "Rechnung verarbeitet!",
        "id": "Struk diproses!",
    },
}


def get_message(key: str, lang: str, **kwargs) -> str:
    """
    Get a translated message by key and language.

    Args:
        key: Message key (e.g., "welcome", "processing")
        lang: Language code (e.g., "es", "en")
        **kwargs: Format arguments for the message

    Returns:
        Translated message string
    """
    # Fallback to English if language not found
    if key not in TRANSLATIONS:
        return f"[Missing translation: {key}]"

    translations = TRANSLATIONS[key]

    # Try requested language, fallback to English, then Spanish
    message = translations.get(lang) or translations.get("en") or translations.get("es", "")

    # Apply format arguments if any
    if kwargs:
        try:
            message = message.format(**kwargs)
        except KeyError:
            pass  # Ignore missing format keys

    return message


def format_collaborative_message_i18n(
    lang: str,
    total: float,
    subtotal: float,
    tip: float,
    items_count: int,
    owner_url: str,
    editor_url: str,
    is_verified: bool = False,
    decimal_places: int = 0,
    number_format: dict = None
) -> str:
    """
    Format the collaborative session message in the specified language.

    Args:
        lang: Language code
        total: Total amount
        subtotal: Subtotal amount
        tip: Tip amount
        items_count: Number of items
        owner_url: URL for the host
        editor_url: URL for sharing
        is_verified: Whether totals are verified (quality_score == 100)
        decimal_places: Number of decimal places for currency (0 for CLP, 2 for USD)
        number_format: Dict with 'thousands' and 'decimal' separators

    Returns:
        Formatted WhatsApp message
    """
    # Calculate tip percentage
    tip_percent = ((tip or 0) / subtotal * 100) if subtotal and subtotal > 0 else 0

    # Get separators from number_format (default to US format)
    # Use 'or' to handle None values inside the dict
    fmt_config = number_format or {'thousands': ',', 'decimal': '.'}
    thousands_sep = fmt_config.get('thousands') or ','
    decimal_sep = fmt_config.get('decimal') or '.'

    # Format currency using the receipt's number format
    def fmt(amount):
        if decimal_places > 0:
            num_str = f"{amount:,.{decimal_places}f}"
        else:
            num_str = f"{amount:,.0f}"
        # Replace separators to match receipt format
        # First replace comma with placeholder, then dot, then placeholder
        num_str = num_str.replace(',', 'THOUSANDS').replace('.', 'DECIMAL')
        num_str = num_str.replace('THOUSANDS', thousands_sep).replace('DECIMAL', decimal_sep)
        return f"${num_str}"

    # Status emoji and text
    if is_verified:
        status_emoji = "✅"
        status_text = get_message("session_verified", lang)
    else:
        status_emoji = "⚠️"
        status_text = get_message("session_review", lang)

    # Build message
    message = f"""🧾 {get_message("receipt_processed", lang)}

{status_emoji} *{status_text}*

💰 {get_message("session_total", lang)}: {fmt(total)}
📊 {get_message("session_subtotal", lang)}: {fmt(subtotal)}
🎁 {get_message("session_tip", lang)}: {fmt(tip)} ({tip_percent:.0f}%)
📝 {get_message("session_items", lang)}: {items_count}

━━━━━━━━━━━━━━━━━━

📌 *{get_message("session_host_link", lang)}:*
{owner_url}

👆 {get_message("session_host_instruction", lang)}

━━━━━━━━━━━━━━━━━━

🔗 *{get_message("session_share_link", lang)}:*
{editor_url}

👆 {get_message("session_share_instruction", lang)}

━━━━━━━━━━━━━━━━━━

⏰ {get_message("session_expires", lang)}"""

    return message
