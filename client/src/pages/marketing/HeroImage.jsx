import whatsappChat from '../../assets/marketing/whatsapp-chat.webp';

// A real WhatsApp AI ordering conversation (the same capture impl-26's 3D
// hero used as its texture/fallback), presented as a plain tilted image —
// the 3D scene it originally shipped in didn't render reliably and was
// pulled; this static treatment is deliberately CSS-only, no JS involved.
export default function HeroImage() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <img
        src={whatsappChat}
        alt="RestoAI WhatsApp ordering conversation"
        className="w-56 rounded-[1.75rem] border-4 border-gray-900 shadow-2xl dark:border-gray-600 sm:w-64"
        style={{ transform: 'rotate(-6deg)' }}
      />
    </div>
  );
}
