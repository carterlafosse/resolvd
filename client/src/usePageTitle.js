// Sets the browser tab's title for a page: "RES-1042 · Resolvd", or just "Resolvd".
import { useDocumentTitle } from '@mantine/hooks';

export const APP_NAME = 'Resolvd';

export function pageTitle(title) {
  return title ? `${title} · ${APP_NAME}` : APP_NAME;
}

export function usePageTitle(title) {
  useDocumentTitle(pageTitle(title));
}
