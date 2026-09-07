export const metadata = {
  title: 'intervieHire | AI-Screening & Expert Human Interviews',
  description: 'intervieHire is an AI-powered talent acquisition platform replacing the fragmented hiring stack with screening and vetted human expert interviews.',

};
// Without this, mobile browsers use a default ~980px layout viewport and
// render candidate-facing pages (e.g. /reschedule) zoomed out to fit it,
// rather than at their actual device width.
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
