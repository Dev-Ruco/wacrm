import { CatalogWorkspaceNav } from '@/components/catalog/catalog-workspace-nav';

export default function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <CatalogWorkspaceNav active="operations" />
      <main className="min-w-0">{children}</main>
    </div>
  );
}
