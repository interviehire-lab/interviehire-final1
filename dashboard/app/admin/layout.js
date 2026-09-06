import AdminShell from "./AdminShell";

export const metadata = {
	title: "Super Admin · intervieHire",
	description: "Platform-wide overview across every organisation.",
};

export default function AdminLayout({ children }) {
	return <AdminShell>{children}</AdminShell>;
}
