const TRANSLATIONS = {
  en: {
    // Login
    'login.subtitle':          'Admin panel',
    'login.tab.apikey':        'API Key',
    'login.tab.email':         'Email',
    'login.tab.register':      'Register',
    'login.api_key':           'API Key',
    'login.password':          'Password',
    'login.password.min':      'Min 6 characters',
    'login.btn':               'Sign in',
    'login.btn.register':      'Create account',
    'login.error.invalid':     'Invalid API key',
    'login.error.fields':      'All fields are required',
    'login.error.password_short': 'Password must be at least 6 characters',
    'login.error.rate_limit':  'Too many attempts. Please wait.',
    'login.error.server':      'Server error',
    'login.error.connect':     'Could not connect: ',

    // Sidebar / nav
    'nav.instances':           'Instances',
    'nav.logs':                'Logs',
    'sidebar.authenticated':   'Authenticated',

    // Instances view
    'instances.title':         'Instances',
    'instances.new':           'New instance',
    'instances.empty':         'No active instances — create a new one',
    'instances.view_detail':   'View detail',
    'instances.connected':     'Connected',

    // Status badges
    'status.connected':        'Connected',
    'status.connecting':       'Connecting…',
    'status.qr':               'Scan QR',
    'status.logged_out':       'Disconnected',
    'status.disconnected':     'Disconnected',

    // Instance detail
    'detail.info':             'Information',
    'detail.status':           'Status',
    'detail.number':           'Number',
    'detail.connected_since':  'Connected since',
    'detail.webhooks':         'Webhooks',
    'detail.webhooks.add':     'Add',
    'detail.webhooks.empty':   'No webhooks configured',
    'detail.disconnect':       'Disconnect',
    'detail.reconnect':        'Reconnect',
    'detail.restart':          'Restart',
    'detail.delete':           'Delete',

    // QR
    'qr.label':                'Scan with WhatsApp',
    'qr.hint':                 'QR expires in ~20 seconds',

    // New instance modal
    'modal.new.title':         'New instance',
    'modal.new.name':          'Name',
    'modal.new.placeholder':   'e.g. sales, support, main',
    'modal.new.connect':       'Connect',

    // Webhook modal
    'modal.wh.title':          'Add webhook',
    'modal.wh.title.edit':     'Edit webhook',
    'modal.wh.url':            'Endpoint URL',
    'modal.wh.url.ph':         'https://your-server.com/webhook',
    'modal.wh.events':         'Events',
    'modal.wh.msg':            'Messages',
    'modal.wh.msg.desc':       'Text, images, audio, documents',
    'modal.wh.join':           'Group join',
    'modal.wh.join.desc':      'Someone joins a group',
    'modal.wh.leave':          'Group leave',
    'modal.wh.leave.desc':     'Someone leaves a group',
    'modal.wh.save':           'Save',

    // Common buttons
    'btn.cancel':              'Cancel',
    'btn.refresh':             'Refresh',
    'btn.back':                'Back',

    // Logs
    'logs.title':              'Message logs',
    'logs.col.instance':       'Instance',
    'logs.col.destination':    'Destination',
    'logs.col.type':           'Type',
    'logs.col.status':         'Status',
    'logs.col.date':           'Date',
    'logs.empty':              'No records yet',

    // Toasts
    'toast.webhook.added':     'Webhook added',
    'toast.webhook.updated':   'Webhook updated',
    'toast.webhook.deleted':   'Webhook deleted',
    'toast.instance.deleted':  'Instance deleted',
    'toast.session.expired':   'Session expired',
    'toast.qr.ready':          'QR ready — scan with WhatsApp',

    // Confirms & validation
    'confirm.disconnect':      'Disconnect and delete instance',
    'confirm.webhook.delete':  'Delete this webhook?',
    'val.enter_name':          'Enter a name',
    'val.invalid_name':        'Only letters, numbers, hyphens and underscores',
    'val.enter_url':           'Enter the webhook URL',
    'val.select_event':        'Select at least one event',
    'val.already_connected':   'already connected',
  },

  es: {
    'login.subtitle':          'Panel de administración',
    'login.tab.apikey':        'API Key',
    'login.tab.email':         'Email',
    'login.tab.register':      'Registro',
    'login.api_key':           'API Key',
    'login.password':          'Contraseña',
    'login.password.min':      'Mínimo 6 caracteres',
    'login.btn':               'Ingresar',
    'login.btn.register':      'Crear cuenta',
    'login.error.invalid':     'API key incorrecta',
    'login.error.fields':      'Todos los campos son requeridos',
    'login.error.password_short': 'La contraseña debe tener al menos 6 caracteres',
    'login.error.rate_limit':  'Demasiados intentos. Espera un momento.',
    'login.error.server':      'Error del servidor',
    'login.error.connect':     'No se pudo conectar: ',

    'nav.instances':           'Instancias',
    'nav.logs':                'Logs',
    'sidebar.authenticated':   'Autenticado',

    'instances.title':         'Instancias',
    'instances.new':           'Nueva instancia',
    'instances.empty':         'No hay instancias activas — crea una nueva',
    'instances.view_detail':   'Ver detalle',
    'instances.connected':     'Conectado',

    'status.connected':        'Conectado',
    'status.connecting':       'Conectando…',
    'status.qr':               'Escanear QR',
    'status.logged_out':       'Desconectado',
    'status.disconnected':     'Desconectado',

    'detail.info':             'Información',
    'detail.status':           'Estado',
    'detail.number':           'Número',
    'detail.connected_since':  'Conectado desde',
    'detail.webhooks':         'Webhooks',
    'detail.webhooks.add':     'Agregar',
    'detail.webhooks.empty':   'Sin webhooks configurados',
    'detail.disconnect':       'Desconectar',
    'detail.reconnect':        'Reconectar',
    'detail.restart':          'Reiniciar',
    'detail.delete':           'Eliminar',

    'qr.label':                'Escanea con WhatsApp',
    'qr.hint':                 'El QR expira en ~20 segundos',

    'modal.new.title':         'Nueva instancia',
    'modal.new.name':          'Nombre',
    'modal.new.placeholder':   'ej: ventas, soporte, principal',
    'modal.new.connect':       'Conectar',

    'modal.wh.title':          'Agregar webhook',
    'modal.wh.title.edit':     'Editar webhook',
    'modal.wh.url':            'URL del endpoint',
    'modal.wh.url.ph':         'https://tu-servidor.com/webhook',
    'modal.wh.events':         'Eventos',
    'modal.wh.msg':            'Mensajes',
    'modal.wh.msg.desc':       'Texto, imágenes, audio, documentos',
    'modal.wh.join':           'Entrada a grupo',
    'modal.wh.join.desc':      'Alguien se une a un grupo',
    'modal.wh.leave':          'Salida de grupo',
    'modal.wh.leave.desc':     'Alguien sale de un grupo',
    'modal.wh.save':           'Guardar',

    'btn.cancel':              'Cancelar',
    'btn.refresh':             'Actualizar',
    'btn.back':                'Volver',

    'logs.title':              'Logs de mensajes',
    'logs.col.instance':       'Instancia',
    'logs.col.destination':    'Destino',
    'logs.col.type':           'Tipo',
    'logs.col.status':         'Estado',
    'logs.col.date':           'Fecha',
    'logs.empty':              'Sin registros aún',

    'toast.webhook.added':     'Webhook agregado',
    'toast.webhook.updated':   'Webhook actualizado',
    'toast.webhook.deleted':   'Webhook eliminado',
    'toast.instance.deleted':  'Instancia eliminada',
    'toast.session.expired':   'Sesión expirada',
    'toast.qr.ready':          'QR listo — escanea con WhatsApp',

    'confirm.disconnect':      '¿Desconectar y eliminar instancia',
    'confirm.webhook.delete':  '¿Eliminar este webhook?',
    'val.enter_name':          'Ingresa un nombre',
    'val.invalid_name':        'Solo letras, números, guiones y guiones bajos',
    'val.enter_url':           'Ingresa la URL del webhook',
    'val.select_event':        'Selecciona al menos un evento',
    'val.already_connected':   'ya conectado',
  },
};

// ── Core ─────────────────────────────────────────────────────────
let _lang = localStorage.getItem('wame_lang') || 'en';

function t(key) {
  return TRANSLATIONS[_lang]?.[key] ?? TRANSLATIONS['en']?.[key] ?? key;
}

function setLang(lang) {
  if (!TRANSLATIONS[lang]) return;
  _lang = lang;
  localStorage.setItem('wame_lang', lang);
  applyTranslations();
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}

function getLang() { return _lang; }
