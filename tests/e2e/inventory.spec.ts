import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function clearLocalData(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase("archivo-lp");
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      }),
  );
}

test("añadir desde galería, recortar, guardar, buscar, exportar, borrar y restaurar", async ({ page }) => {
  await page.goto("/");
  await clearLocalData(page);
  await page.reload();
  await expect(page.getByText("Aún no hay discos en el archivo.")).toBeVisible();

  // Import one photo from the gallery input (single mode navigates to review).
  await page.goto("/agregar");
  await page.getByTestId("gallery-input").setInputFiles("tests/fixtures/cover-a.png");
  await expect(page).toHaveURL(/\/revisar\?id=/);
  await expect(page.getByRole("heading", { name: "Recortar la portada" })).toBeVisible();

  // Rotate once and back, then accept the crop.
  await page.getByRole("button", { name: "↻ Girar" }).click();
  await page.getByRole("button", { name: "↺ Girar" }).click();
  await page.getByRole("button", { name: "Usar este recorte" }).click();
  await expect(page.getByRole("heading", { name: "Datos del disco" })).toBeVisible();

  await page.getByLabel("Título del álbum").fill("Canción de Prueba");
  await page.getByLabel("Nombre del crédito 1").fill("Orquesta Ñandú");
  await page.getByLabel("Año original").fill("1975");
  await page.getByLabel("Géneros (separados por coma)").fill("Bolero, Jazz");
  await page.getByRole("button", { name: "Guardar como confirmado" }).click();

  await expect(page).toHaveURL(/\/ejemplar\?id=/);
  await expect(page.getByRole("heading", { name: "Canción de Prueba" })).toBeVisible();
  await expect(page.getByText("Fotos (2)")).toBeVisible();

  // Survives reload; accent-insensitive search.
  await page.goto("/");
  await page.reload();
  await expect(page.getByTestId("counts")).toContainText("1 ejemplares");
  await page.getByPlaceholder(/Buscar por título/).fill("cancion nandu");
  await expect(page.getByTestId("collection-grid")).toContainText("Canción de Prueba");
  await page.getByPlaceholder(/Buscar por título/).fill("rock");
  await expect(page.getByText("Nada coincide")).toBeVisible();

  // Full backup with photos.
  await page.goto("/ajustes");
  await expect(page.getByTestId("backup-status")).toContainText("nunca");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar todo con fotos (.zip)" }).click();
  const download = await downloadPromise;
  const zipPath = test.info().outputPath("respaldo.zip");
  await download.saveAs(zipPath);
  await expect(page.getByTestId("backup-status")).not.toContainText("nunca");
  expect(readFileSync(zipPath).subarray(0, 2).toString()).toBe("PK");

  // Simulate losing the browser data.
  await clearLocalData(page);
  await page.goto("/");
  await expect(page.getByText("Aún no hay discos en el archivo.")).toBeVisible();

  // Restore with preview + confirmation.
  await page.goto("/ajustes");
  await page.getByTestId("restore-input").setInputFiles(zipPath);
  await expect(page.getByTestId("restore-preview")).toContainText("Se añadirán 1 ejemplares nuevos");
  await page.getByRole("button", { name: "Restaurar", exact: true }).click();
  await expect(page.getByText(/Restauración completa: 1 ejemplares añadidos/)).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("collection-grid")).toContainText("Canción de Prueba");
  await page.getByText("Canción de Prueba").click();
  await expect(page.getByText("Fotos (2)")).toBeVisible();
  await expect(page.getByText("Bolero, Jazz")).toBeVisible();
});

test("rechaza un archivo que no es imagen sin perder nada", async ({ page }) => {
  await page.goto("/agregar");
  await page.getByTestId("gallery-input").setInputFiles({
    name: "falso.jpg",
    mimeType: "image/jpeg",
    buffer: readFileSync("tests/fixtures/not-an-image.png"),
  });
  await expect(page.getByText(/Formato no reconocido/)).toBeVisible();
});

test("un disco desconocido se guarda y aparece en Pendientes", async ({ page }) => {
  await page.goto("/");
  await clearLocalData(page);
  await page.goto("/agregar");
  await page.getByTestId("gallery-input").setInputFiles("tests/fixtures/cover-b.png");
  await expect(page).toHaveURL(/\/revisar\?id=/);
  await page.getByRole("button", { name: "Foto completa" }).click();
  await page.getByRole("button", { name: "Usar este recorte" }).click();
  await page.getByRole("button", { name: "Guardar como desconocido" }).click();
  await page.goto("/pendientes");
  await expect(page.getByText("Desconocido").first()).toBeVisible();
  await expect(page.getByText("Sin título")).toBeVisible();
});

test("el estado del reconocimiento indica modo simulado", async ({ page }) => {
  await page.goto("/ajustes");
  await expect(page.getByTestId("vision-status")).toContainText(/simulado/i);
});

// Next keeps visited routes mounted but hidden, so label lookups must skip hidden copies.
const titleField = (page: Page) => page.getByLabel("Título del álbum").filter({ visible: true });

async function pickPhoto(page: Page, button: string, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button, exact: true }).click();
  await (await chooser).setFiles(file);
}

test("alta manual con todos los datos e imágenes, y gestión de fotos al editar", async ({ page }) => {
  await page.goto("/");
  await clearLocalData(page);
  await page.goto("/agregar");
  await page.getByRole("link", { name: /Agregar manualmente/ }).click();
  await expect(page).toHaveURL(/\/manual/);

  await pickPhoto(page, "+ Contraportada", "tests/fixtures/cover-b.png");
  await pickPhoto(page, "+ Portada", "tests/fixtures/cover-a.png");
  await expect(page.getByTestId("manual-photos").locator("li")).toHaveCount(2);

  await page.getByLabel("Título del álbum").fill("Disco Manual");
  await page.getByLabel("Nombre del crédito 1").fill("Los Manuales");
  await page.getByText("Datos de esta edición física").click();
  await page.getByLabel("Sello").fill("Peerless");
  await page.getByLabel("Número de catálogo").fill("LPS-001");
  await page.getByRole("button", { name: "Guardar como confirmado" }).click();

  await expect(page).toHaveURL(/\/ejemplar\?id=/);
  await expect(page.getByRole("heading", { name: "Disco Manual" })).toBeVisible();
  await expect(page.getByText("Peerless")).toBeVisible();
  await expect(page.getByText("Fotos (2)")).toBeVisible();

  // Editing: unsaved form changes survive adding a photo; photos can be removed.
  await page.getByRole("link", { name: "Editar" }).click();
  await titleField(page).fill("Disco Manual Editado");
  await pickPhoto(page, "+ Etiqueta", "tests/fixtures/cover-a.png");
  await expect(page.getByTestId("copy-photos").locator("li")).toHaveCount(3);
  await expect(titleField(page)).toHaveValue("Disco Manual Editado");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("copy-photos").locator("li").first().getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByTestId("copy-photos").locator("li")).toHaveCount(2);
  await page.getByRole("button", { name: "Guardar como confirmado" }).click();

  await expect(page.getByRole("heading", { name: "Disco Manual Editado" })).toBeVisible();
  await expect(page.getByText("Fotos (2)")).toBeVisible();

  // Returning to manual entry starts with an empty form.
  await page.getByRole("link", { name: "Agregar", exact: true }).click();
  await page.getByRole("link", { name: /Agregar manualmente/ }).click();
  await expect(titleField(page)).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Imágenes (0)" })).toBeVisible();
});
