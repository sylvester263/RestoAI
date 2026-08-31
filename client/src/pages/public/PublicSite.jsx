import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { sitesApi } from '../../lib/api';
import { TEMPLATE_CONFIGS } from './landing/templates';
import { Hero, About, MenuHighlights, Gallery, Testimonials, HoursLocation, Contact } from './landing/Sections';
import DarkModeToggle from '../../components/DarkModeToggle';
import useDarkMode from '../../hooks/useDarkMode';

const SECTION_COMPONENTS = {
  hero: Hero,
  about: About,
  menu: MenuHighlights,
  gallery: Gallery,
  testimonials: Testimonials,
  hours: HoursLocation,
  contact: Contact,
};

export default function PublicSite() {
  const { subdomain } = useParams();
  const [site, setSite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    sitesApi.getSite(subdomain)
      .then((res) => {
        setSite(res);
        document.title = res.tenant.name;
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [subdomain]);

  if (loading) return <div className="flex min-h-screen items-center justify-center text-gray-400">Loading...</div>;
  if (notFound || !site) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-lg font-medium text-gray-700">This site isn't available.</p>
        <p className="text-sm text-gray-400">It may be unpublished or the address may be wrong.</p>
      </div>
    );
  }

  const config = TEMPLATE_CONFIGS[site.template_id] || TEMPLATE_CONFIGS['classic-warm'];
  const { isDark: userDark } = useDarkMode();
  const dark = !!config.dark || userDark;

  return (
    <div className={`min-h-screen ${config.fontClass} ${dark ? 'bg-stone-950 text-gray-100' : 'bg-white text-gray-900'}`}>
      {config.order.map((key, i) => {
        const Section = SECTION_COMPONENTS[key];
        if (!Section) return null;
        const bgFn = dark && config.darkSectionBg ? config.darkSectionBg : config.sectionBg;
        const bg = bgFn(i);
        return (
          <Section
            key={key}
            content={site.content}
            theme={site.theme}
            tenant={site.tenant}
            menuItems={site.featured_menu_items}
            testimonials={site.testimonials}
            currency={site.tenant.currency}
            config={config}
            dark={dark}
            bg={bg}
          />
        );
      })}
      <footer className={`py-6 text-center text-xs ${dark ? 'text-stone-500' : 'text-gray-400'}`}>
        <div className="mb-2 flex justify-center">
          <DarkModeToggle />
        </div>
        {site.tenant.name} · Powered by RestoAI
      </footer>
    </div>
  );
}
