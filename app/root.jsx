import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { AppProvider } from "@shopify/polaris";
import polarisStylesheetUrl from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStylesheetUrl },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider i18n={{}}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}