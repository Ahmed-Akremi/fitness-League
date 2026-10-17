import { config, type SiteConfig } from '../config';
import type { Copy } from '../content';

/** Plain text badges: the official store artwork has its own usage rules. */
export function StoreBadges({ t, stores = config.stores }: { t: Copy; stores?: SiteConfig['stores'] }) {
  const badges = [
    { name: t.stores.appStore, href: stores.appStore },
    { name: t.stores.googlePlay, href: stores.googlePlay },
  ];
  return (
    <ul className="stores">
      {badges.map(({ name, href }) => (
        <li key={name}>
          {href ? (
            <a className="store" href={href}>
              <span className="store-name">{name}</span>
            </a>
          ) : (
            <span className="store is-soon">
              <span className="store-name">{name}</span>
              <span className="store-note">{t.stores.soon}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
