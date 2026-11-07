Single purpose

Shows the current website's Ahrefs Domain Rating (DR) in the extension badge, either on demand or automatically when the user switches to or opens a tab, with support for both DR3 and DR4 calculation models.

Permission justifications

`contextMenus`
Used to provide a right-click menu on the extension icon so the user can enable or disable automatic DR lookup and toggle between Domain Rating versions (DR3 and DR4).

`storage`
Used to save the user's Auto DR preference and chosen DR version (DR3 or DR4) locally.

`tabs`
Used to detect tab activation and page load completion, and to read the current tab URL so the extension can fetch the Ahrefs Domain Rating for that website.

Host permission: `https://api.ahrefs.com/*`
Used only to send a request from the extension service worker to the Ahrefs API endpoint that returns the Domain Rating for the current website.

Remote code

No. The extension does not load or execute remotely hosted code. It only sends a network request to the Ahrefs API to retrieve the DR value.

Data handling

The extension reads the URL of the current tab only to extract the hostname and request its DR from Ahrefs. It does not collect browsing history, page content, credentials, or personal data, and it does not transmit any data except the current hostname needed for the Ahrefs API request.
