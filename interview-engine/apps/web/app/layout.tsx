import { FloatingControls } from '@/components/FloatingControls';

import './globals.css';

export const metadata = { title: 'IntervieHire', description: 'AI-powered interview platform' };
// Without this, mobile browsers use a default ~980px layout viewport and
// render the whole page zoomed out to fit it — every max-width media query
// in roomStyles.ts (and every other page here) would then simply never
// match a real phone's reported width, no matter how the CSS is written.
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>
				<FloatingControls />
				{children}
			</body>
		</html>
	);
}
