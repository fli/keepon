const tailwind600: Record<string, string> = {
  amber: '#d97706',
  blue: '#2563eb',
  cyan: '#0ea5e9',
  emerald: '#059669',
  fuchsia: '#c026d3',
  green: '#16a34a',
  indigo: '#4f46e5',
  lightBlue: '#0284c7',
  lime: '#65a30d',
  orange: '#ea580c',
  pink: '#db2777',
  purple: '#7c3aed',
  red: '#dc2626',
  rose: '#e11d48',
  sky: '#0284c7',
  teal: '#0d9488',
  violet: '#7c3aed',
  yellow: '#ca8a04',
}

export type ClientEmailProps = {
  bodyHeading: string
  bodyHtml: string
  button?: {
    text: string
    link: URL
  }
  logo?: {
    url: string
    alt?: string
  }
  brandColor?: string
  receivingReason: string
}

const escapeHtml = (value: string) =>
  value
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
    .replaceAll(/'/g, '&#39;')

const resolveBrandColor = (value?: string) => (value && tailwind600[value]) ?? tailwind600.blue

const ctaEmail = ({ bodyHeading, bodyHtml, button, logo, brandColor, receivingReason }: ClientEmailProps) => {
  const buttonColor = resolveBrandColor(brandColor)
  const logoMarkup = logo?.url
    ? `<img src="${logo.url}" alt="${escapeHtml(logo.alt ?? '')}" style="max-width:160px;height:auto;border-radius:12px;" />`
    : ''
  const buttonMarkup = button
    ? `<a href="${button.link.toString()}" style="background:${buttonColor};color:#ffffff;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">${escapeHtml(button.text)}</a>`
    : ''

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                ${logoMarkup}
              </td>
            </tr>
            <tr>
              <td style="font-size:22px;font-weight:700;color:#111827;text-align:center;padding-bottom:12px;">
                ${escapeHtml(bodyHeading)}
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:16px;text-align:center;">
                ${bodyHtml}
              </td>
            </tr>
            ${buttonMarkup ? `<tr><td align="center" style="padding:16px 0;">${buttonMarkup}</td></tr>` : ''}
            <tr>
              <td style="font-size:12px;line-height:1.6;color:#6b7280;padding-top:16px;text-align:center;">
                You received this email because ${escapeHtml(receivingReason)}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export default ctaEmail
