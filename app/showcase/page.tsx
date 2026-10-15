import { getShowcaseItems } from "@/lib/showcase-queries";
import { getScannerToken } from "@/app/actions";
import { AppHeader } from "@/components/app-header";
import { ShowcaseRoute } from "@/components/showcase-route";

export const dynamic = "force-dynamic";

export default async function ShowcasePage() {
  const [items, scannerToken] = await Promise.all([getShowcaseItems(), getScannerToken()]);

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:h-dvh lg:overflow-hidden">
      <AppHeader active="showcase" />
      <div className="flex flex-1 flex-col p-4 sm:p-6 lg:overflow-y-auto">
        <ShowcaseRoute items={items} scannerToken={scannerToken} />
      </div>
    </div>
  );
}
