import { expect, test, type Page } from "@playwright/test";

const PARIS_LYON_COORDS: Array<[number, number]> = [
  [2.3522, 48.8566],
  [2.578, 48.445],
  [2.5954, 48.3386],
  [3.57, 47.82],
  [4.3095, 47.4366],
  [4.792, 46.283],
  [4.718, 45.978],
  [4.8357, 45.764],
];

const PARIS_LYON_TOLL_FREE_COORDS: Array<[number, number]> = [
  [2.3522, 48.8566],
  [2.7, 48.3],
  [3.3, 47.7],
  [4.1, 47.1],
  [4.6, 46.3],
  [4.8357, 45.764],
];

const encodePolyline6 = (coordinates: Array<[number, number]>): string => {
  let prevLat = 0;
  let prevLon = 0;
  let result = "";

  const encodeValue = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      result += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    result += String.fromCharCode(v + 63);
  };

  for (const [lon, lat] of coordinates) {
    const scaledLat = Math.round(lat * 1e6);
    const scaledLon = Math.round(lon * 1e6);
    encodeValue(scaledLat - prevLat);
    encodeValue(scaledLon - prevLon);
    prevLat = scaledLat;
    prevLon = scaledLon;
  }

  return result;
};

const mockExternalRoutingApis = async (page: Page) => {
  const tollFreeShape = encodePolyline6(PARIS_LYON_TOLL_FREE_COORDS);

  await page.route(
    /https:\/\/(router\.project-osrm\.org|routing\.openstreetmap\.de)\/.*/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 465_000,
              duration: 16_200,
              geometry: {
                coordinates: PARIS_LYON_COORDS,
              },
            },
          ],
        }),
      }),
  );

  await page.route("https://valhalla1.openstreetmap.de/route", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        trip: {
          summary: {
            length: 492,
            time: 27_180,
          },
          legs: [{ shape: tollFreeShape }],
        },
      }),
    }),
  );

  await page.route("https://photon.komoot.io/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        features: [
          {
            geometry: { coordinates: [4.8357, 45.764] },
            properties: {
              osm_id: 1,
              name: "Lyon",
              city: "Lyon",
              postcode: "69000",
              state: "Auvergne-Rhône-Alpes",
              country: "France",
            },
          },
        ],
      }),
    }),
  );
};

test.describe("PeageMap E2E", () => {
  test("loads dataset, computes Paris -> Lyon tolls, and renders map markers", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await mockExternalRoutingApis(page);
    await page.goto("/");

    await expect(page.getByText(/579 gares · 16\s?624 tarifs/)).toBeVisible();
    await page.getByRole("button", { name: "Paris → Lyon" }).click();

    await expect(page.getByRole("button", { name: /Direct/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Votre trajet/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sans péage/ })).toBeVisible();
    await expect(page.getByText("Erreur applicative")).toHaveCount(0);

    // MapLibre DOM markers (A / B / toll pills) must render on the map
    const mapRegion = page.locator(".maplibregl-map");
    await expect(mapRegion.locator(".maplibregl-marker").first()).toBeVisible({ timeout: 15_000 });
    expect(pageErrors).toEqual([]);
  });

  test("toggling Sans péage (tf=1) and Télépéage (tp=1) works and survives page reload", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await mockExternalRoutingApis(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Paris → Lyon" }).click();
    await expect(page.getByRole("button", { name: /Sans péage/ })).toBeVisible();

    await page.getByRole("button", { name: /Sans péage/ }).click();
    await expect(page).toHaveURL(/tf=1/);
    await expect(page.getByText("Erreur applicative")).toHaveCount(0);

    await page.getByRole("button", { name: "0 €", exact: true }).click();
    await expect(page.getByText("Erreur applicative")).toHaveCount(0);

    await page.getByRole("button", { name: /Badge Télépéage/ }).click();
    await expect(page).toHaveURL(/tp=1/);
    await expect(page.getByText(/~2 min\/sortie/)).toBeVisible();

    // Reload directly on URL containing numeric tf=1 and tp=1 params
    await page.reload();
    await expect(page.getByText("Erreur applicative")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Sans péage/ })).toBeVisible();
    await expect(page.getByText(/~2 min\/sortie/)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("supports profiles, entry/exit editing, Undo button, and Ctrl/Cmd+Z", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await mockExternalRoutingApis(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Paris → Lyon" }).click();
    await expect(page.getByRole("button", { name: "Équilibré" })).toBeVisible();

    await page.getByRole("button", { name: "Équilibré" }).click();
    await expect(page).toHaveURL(/splits=/);

    const undoButtons = page.getByRole("button", { name: "Annuler" });
    await expect(undoButtons).toHaveCount(2);

    const entrySelect = page.getByLabel(/Entrer sur APRR/);
    const initialEntry = await entrySelect.inputValue();
    await entrySelect.selectOption({ index: 2 });
    const changedEntry = await entrySelect.inputValue();
    expect(changedEntry).not.toBe(initialEntry);

    // Undo via map/sidebar button restores the previous entry plaza
    await undoButtons.first().click();
    await expect(entrySelect).toHaveValue(initialEntry);

    // Undo via keyboard shortcut restores pre-Équilibré state (removes splits)
    await page.locator("header h1").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page).not.toHaveURL(/splits=/);
    expect(pageErrors).toEqual([]);
  });

  test("handles malformed URL search params without crashing", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await mockExternalRoutingApis(page);
    await page.goto("/?tf=999&tp=invalid&vc=c99&from=bad");

    await expect(page.getByText("Erreur applicative")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "PeageMap" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
