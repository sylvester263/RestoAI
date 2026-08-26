import { MapPin, Phone, MessageCircle, Facebook, Instagram, Star } from 'lucide-react';

function CtaButton({ children, href, accent, outline }) {
  return (
    <a
      href={href}
      className={`inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold shadow-sm transition-opacity hover:opacity-90 ${
        outline ? 'border-2 bg-transparent' : 'text-white'
      }`}
      style={outline ? { borderColor: accent, color: accent } : { backgroundColor: accent }}
    >
      {children}
    </a>
  );
}

function HeroCtas({ config, tenantSlug, accent }) {
  const orderHref = `/order/${tenantSlug}`;
  const reserveHref = `/order/${tenantSlug}/reserve`;
  if (config.primaryCta === 'reserve') {
    return (
      <div className="flex flex-wrap gap-3">
        <CtaButton href={reserveHref} accent={accent}>Reserve a Table</CtaButton>
        <CtaButton href={orderHref} accent={accent} outline>Order Online</CtaButton>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-3">
      <CtaButton href={orderHref} accent={accent}>Order Now</CtaButton>
      <CtaButton href={reserveHref} accent={accent} outline>Book a Table</CtaButton>
    </div>
  );
}

export function Hero({ content, config, tenant, theme, dark }) {
  const hero = content?.hero || {};
  if (!hero.headline) return null;
  const accent = theme?.accent_color || '#16a34a';
  const textColor = dark || config.heroStyle === 'fullbleed' ? 'text-white' : 'text-gray-900';

  if (config.heroStyle === 'fullbleed') {
    return (
      <section
        className="relative flex min-h-[32rem] items-center justify-center bg-cover bg-center px-6 py-24 text-center"
        style={{
          backgroundImage: hero.image_url
            ? `linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.55)), url(${hero.image_url})`
            : 'linear-gradient(135deg, #1f2937, #111827)',
        }}
      >
        <div className="max-w-2xl">
          <h1 className={`${config.fontClass} mb-4 text-4xl font-bold sm:text-5xl ${textColor}`} style={{ textWrap: 'balance' }}>
            {hero.headline}
          </h1>
          {hero.subheadline && <p className="mb-8 text-lg text-gray-200">{hero.subheadline}</p>}
          <div className="flex justify-center"><HeroCtas config={config} tenantSlug={tenant.slug} accent={accent} /></div>
        </div>
      </section>
    );
  }

  if (config.heroStyle === 'compact') {
    return (
      <section className="px-6 py-16 text-center">
        <h1 className={`${config.fontClass} mb-3 text-3xl font-bold text-gray-900 sm:text-4xl`}>{hero.headline}</h1>
        {hero.subheadline && <p className="mb-6 text-base text-gray-600">{hero.subheadline}</p>}
        <div className="flex justify-center"><HeroCtas config={config} tenantSlug={tenant.slug} accent={accent} /></div>
      </section>
    );
  }

  // boxed: image beside text
  return (
    <section className="grid gap-8 px-6 py-16 sm:grid-cols-2 sm:items-center sm:px-12">
      <div>
        <h1 className={`${config.fontClass} mb-4 text-3xl font-bold text-gray-900 sm:text-4xl`}>{hero.headline}</h1>
        {hero.subheadline && <p className="mb-6 text-base text-gray-600">{hero.subheadline}</p>}
        <HeroCtas config={config} tenantSlug={tenant.slug} accent={accent} />
      </div>
      {hero.image_url && (
        <img src={hero.image_url} alt="" className="aspect-[4/3] w-full rounded-2xl object-cover shadow-md" />
      )}
    </section>
  );
}

export function About({ content, config, dark, bg }) {
  const about = content?.about || {};
  if (!about.text) return null;
  return (
    <section className="px-6 py-16 sm:px-12" style={{ backgroundColor: bg }}>
      <div className={`mx-auto grid max-w-4xl gap-8 ${about.image_url ? 'sm:grid-cols-2 sm:items-center' : ''}`}>
        {about.image_url && (
          <img src={about.image_url} alt="" className="aspect-square w-full rounded-2xl object-cover shadow-md" />
        )}
        <div>
          <h2 className={`${config.fontClass} mb-4 text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Our Story</h2>
          <p className={`whitespace-pre-wrap text-base leading-relaxed ${dark ? 'text-gray-300' : 'text-gray-600'}`}>{about.text}</p>
        </div>
      </div>
    </section>
  );
}

export function MenuHighlights({ menuItems, tenant, config, dark, bg, currency }) {
  if (!menuItems || menuItems.length === 0) return null;
  return (
    <section className="px-6 py-16 sm:px-12" style={{ backgroundColor: bg }}>
      <div className="mx-auto max-w-5xl">
        <h2 className={`${config.fontClass} mb-8 text-center text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>
          From Our Menu
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {menuItems.map((item) => (
            <div key={item.id} className={`overflow-hidden rounded-xl shadow-sm ${dark ? 'bg-gray-800' : 'bg-white border border-gray-100'}`}>
              {item.image_url && <img src={item.image_url} alt="" className="h-40 w-full object-cover" />}
              <div className="p-4">
                <p className={`font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>{item.name}</p>
                {item.description && (
                  <p className={`mt-1 text-sm line-clamp-2 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{item.description}</p>
                )}
                <p className="mt-2 text-sm font-semibold" style={{ color: '#16a34a' }}>
                  {currency} {Number(item.price).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <a href={`/order/${tenant.slug}`} className="text-sm font-semibold underline" style={{ color: dark ? '#fff' : '#16a34a' }}>
            View full menu &amp; order →
          </a>
        </div>
      </div>
    </section>
  );
}

export function Gallery({ content, config, dark, bg }) {
  const urls = content?.gallery?.image_urls || [];
  if (urls.length === 0) return null;
  return (
    <section className="px-6 py-16 sm:px-12" style={{ backgroundColor: bg }}>
      <div className="mx-auto max-w-5xl">
        <h2 className={`${config.fontClass} mb-8 text-center text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Gallery</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {urls.map((url, i) => (
            <img key={i} src={url} alt="" className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
      </div>
    </section>
  );
}

export function Testimonials({ testimonials, config, dark, bg }) {
  if (!testimonials || testimonials.length === 0) return null;
  return (
    <section className="px-6 py-16 sm:px-12" style={{ backgroundColor: bg }}>
      <div className="mx-auto max-w-4xl">
        <h2 className={`${config.fontClass} mb-8 text-center text-2xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>
          What People Say
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {testimonials.map((t, i) => (
            <div key={i} className={`rounded-xl p-5 ${dark ? 'bg-gray-800' : 'bg-white shadow-sm border border-gray-100'}`}>
              <div className="mb-2 flex gap-0.5 text-yellow-400">
                {Array.from({ length: 5 }).map((_, j) => <Star key={j} className="h-4 w-4 fill-current" />)}
              </div>
              <p className={`mb-3 text-sm italic ${dark ? 'text-gray-300' : 'text-gray-600'}`}>&ldquo;{t.quote}&rdquo;</p>
              <p className={`text-sm font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>{t.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HoursLocation({ content, config, dark, bg }) {
  const hl = content?.hours_location || {};
  if (!hl.address && !hl.hours) return null;
  return (
    <section className="px-6 py-16 sm:px-12" style={{ backgroundColor: bg }}>
      <div className="mx-auto grid max-w-3xl gap-8 sm:grid-cols-2">
        {hl.address && (
          <div>
            <h3 className={`mb-2 flex items-center gap-2 font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>
              <MapPin className="h-4 w-4" /> Location
            </h3>
            <p className={`whitespace-pre-wrap text-sm ${dark ? 'text-gray-300' : 'text-gray-600'}`}>{hl.address}</p>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(hl.address)}`}
              target="_blank" rel="noreferrer"
              className="mt-2 inline-block text-sm font-medium underline"
              style={{ color: dark ? '#fff' : '#16a34a' }}
            >
              View on Google Maps
            </a>
          </div>
        )}
        {hl.hours && (
          <div>
            <h3 className={`mb-2 font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>Hours</h3>
            <p className={`whitespace-pre-wrap text-sm ${dark ? 'text-gray-300' : 'text-gray-600'}`}>{hl.hours}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function Contact({ content, config, dark, bg }) {
  const contact = content?.contact || {};
  const social = contact.social_links || {};
  const hasAny = contact.phone || contact.whatsapp || social.facebook || social.instagram;
  if (!hasAny) return null;
  return (
    <section className="px-6 py-16 text-center sm:px-12" style={{ backgroundColor: bg }}>
      <h3 className={`mb-4 font-semibold ${dark ? 'text-white' : 'text-gray-900'}`}>Get in Touch</h3>
      <div className={`flex flex-wrap justify-center gap-6 text-sm ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="flex items-center gap-2 hover:underline"><Phone className="h-4 w-4" /> {contact.phone}</a>
        )}
        {contact.whatsapp && (
          <a href={`https://wa.me/${contact.whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
        )}
        {social.facebook && (
          <a href={social.facebook} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline"><Facebook className="h-4 w-4" /> Facebook</a>
        )}
        {social.instagram && (
          <a href={social.instagram} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline"><Instagram className="h-4 w-4" /> Instagram</a>
        )}
      </div>
    </section>
  );
}
