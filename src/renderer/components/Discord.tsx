import { useI18n } from '../i18n';

/** Invite link of the ChaldLauncher community server. */
export const DISCORD_URL = 'https://discord.gg/bZyufCB2h7';

const GLYPH = 'M4 0h5v1h-5zM15 0h5v1h-5zM2 1h9v1h-9zM13 1h9v1h-9zM1 2h22v1h-22zM0 3h24v1h-24zM0 4h24v1h-24zM0 5h24v1h-24zM0 6h24v1h-24zM0 7h24v1h-24zM0 8h6v1h-6zM9 8h6v1h-6zM18 8h6v1h-6zM0 9h6v1h-6zM9 9h6v1h-6zM18 9h6v1h-6zM0 10h6v1h-6zM9 10h6v1h-6zM18 10h6v1h-6zM0 11h24v1h-24zM0 12h24v1h-24zM0 13h24v1h-24zM1 14h22v1h-22zM2 15h8v1h-8zM14 15h8v1h-8zM3 16h5v1h-5zM16 16h5v1h-5zM4 17h3v1h-3zM17 17h3v1h-3zM5 18h2v1h-2zM17 18h2v1h-2z';

const TILES: { id: string; path: string }[] = [
  { id: 'help', path: 'M2 0h4v1h-4zM1 1h2v1h-2zM5 1h2v1h-2zM6 2h2v1h-2zM4 3h2v1h-2zM3 4h2v1h-2zM3 6h2v1h-2zM3 7h2v1h-2z' },
  { id: 'bugs', path: 'M0 0h1v1h-1zM3 0h2v1h-2zM7 0h1v1h-1zM1 1h6v1h-6zM2 2h4v1h-4zM0 3h8v1h-8zM2 4h4v1h-4zM0 5h8v1h-8zM1 6h1v1h-1zM3 6h2v1h-2zM6 6h1v1h-1zM0 7h1v1h-1zM3 7h2v1h-2zM7 7h1v1h-1z' },
  { id: 'news', path: 'M3 0h2v1h-2zM2 1h4v1h-4zM2 2h4v1h-4zM1 3h6v1h-6zM1 4h6v1h-6zM0 5h8v1h-8zM3 7h2v1h-2z' },
  { id: 'builds', path: 'M2 0h4v1h-4zM1 1h6v1h-6zM0 2h8v1h-8zM0 3h8v1h-8zM0 4h8v1h-8zM0 5h8v1h-8zM1 6h6v1h-6zM2 7h4v1h-4z' },
  { id: 'ideas', path: 'M2 0h4v1h-4zM1 1h6v1h-6zM0 2h8v1h-8zM0 3h8v1h-8zM1 4h6v1h-6zM2 5h4v1h-4zM2 6h4v1h-4zM3 7h2v1h-2z' },
  { id: 'chat', path: 'M0 0h8v1h-8zM0 1h8v1h-8zM0 2h2v1h-2zM6 2h2v1h-2zM0 3h8v1h-8zM0 4h4v1h-4zM0 5h3v1h-3zM0 6h2v1h-2zM0 7h1v1h-1z' },
];

/** Pixel Discord logo (same artwork as on the website). */
export function DiscordGlyph({ className, fill = 'currentColor' }: { className?: string; fill?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 19" shapeRendering="crispEdges" fill={fill} aria-hidden="true">
      <path d={GLYPH} />
    </svg>
  );
}

/** Green «join» button. Links open in the OS browser (the main process only allows https). */
export function DiscordButton({ block = false, className = '' }: { block?: boolean; className?: string }) {
  const { t } = useI18n();
  return (
    <a
      className={`btn btn--discord${block ? ' btn--block' : ''} ${className}`.trim()}
      href={DISCORD_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      <DiscordGlyph className="btn--discord__icon" />
      <span>{t('discord.join')}</span>
    </a>
  );
}

/** Big community card for the home page. */
export function DiscordSection() {
  const { t } = useI18n();
  return (
    <section className="dc">
      <h3 className="dc__title">
        {t('discord.titleStart')}
        {t('discord.titleStart') ? ' ' : ''}
        <span>Discord</span>
        {t('discord.titleEnd')}
      </h3>
      <div className="dc__body">
        <a className="dc__card" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          <DiscordGlyph className="dc__logo" fill="#5865f2" />
          <b className="dc__name">Discord</b>
          <span className="dc__cap">{t('discord.community')}</span>
          <span className="dc__link">discord.gg/bZyufCB2h7</span>
        </a>
        <div className="dc__grid">
          {TILES.map((tile) => (
            <div key={tile.id} className="dc__tile">
              <i>
                <svg viewBox="0 0 8 8" shapeRendering="crispEdges" fill="#5865f2" aria-hidden="true">
                  <path d={tile.path} />
                </svg>
              </i>
              <p>
                <b>{t(`discord.${tile.id}`)}</b>
                <span>{t(`discord.${tile.id}Text`)}</span>
              </p>
            </div>
          ))}
        </div>
      </div>
      <DiscordButton />
    </section>
  );
}
