import path from "node:path";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { test, expect, type Page } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import {
  closeModelPicker,
  applyProfileFromPicker,
  expectComposerModel,
  expectHostAgentProfiles,
  expectProfilePinnedAboveProviders,
  expectModelRowSelected,
  stageLegacyFavoritesForHostMigration,
  expectModelSearchEmptyState,
  expectModelPickerHeight,
  expectModelPickerWidth,
  expectModelSearchResult,
  expectPinnedProfilesHidden,
  openModelPicker,
  readModelPickerHeight,
  readModelPickerWidth,
  searchAllModels,
  seedAgentProfiles,
  seedModelProvider,
  expectSearchResultsVirtualized,
} from "../support/helpers/agent-profiles";
import { expectComposerVisible } from "../support/helpers/composer";
import { clickNewChat, clickNewTerminal, gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";

const MOCK_PROVIDER_LABEL = "Mock Load Test";

// Its fast model deliberately carries the same label as the mock provider's, so
// the only thing telling the two result rows apart is the provider name.
const STUDIO = {
  id: "mock-studio",
  label: "Mock Studio",
  models: [
    { id: "studio-fast", label: "Ten second stream", description: "Studio quick pass" },
    { id: "studio-deep", label: "Studio deep think", description: "Studio long pass" },
  ],
};

// Pinned profiles must remain available alongside cross-provider search.
const ROOT_VIEW_PROFILE = {
  id: "agent_profile_e2e_search_root",
  name: "Search anchor",
  provider: "mock",
};

const LARGE_CATALOG_SIZE = 200;
const LARGE_CATALOG = {
  id: "mock-bulk",
  label: "Mock Bulk",
  models: Array.from({ length: LARGE_CATALOG_SIZE }, (_, index) => ({
    id: `bulk-${index}`,
    label: `Bulk model ${index}`,
    description: `Bulk search result ${index}`,
  })),
};

test.describe("Cross-provider model search", () => {
  test("Claude and Codex favorites and search share the draft picker", async ({
    page,
  }, testInfo) => {
    const client = await connectDaemonClient<DaemonClient>({
      clientIdPrefix: "claude-codex-picker",
    });
    const previous = await client.getDaemonConfig();
    const profiles = await seedAgentProfiles([]);
    const workspace = await seedWorkspace({ repoPrefix: "claude-codex-picker-" });
    // Exercise the built-in provider identities with deterministic discovery;
    // selecting a draft model must not start either provider's paid session.
    try {
      await client.patchDaemonConfig({
        providers: {
          claude: {
            enabled: true,
            command: [process.execPath],
            label: "Claude",
            models: [{ id: "opus", label: "Opus" }],
          },
          codex: {
            enabled: true,
            command: [process.execPath],
            label: "Codex",
            models: [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }],
          },
        },
      });
      await stageLegacyFavoritesForHostMigration(page, [
        { provider: "claude", modelId: "opus" },
        { provider: "codex", modelId: "gpt-5.6-sol" },
      ]);
      await expectHostAgentProfiles([
        { id: "legacy_favorite:claude:opus", name: "Opus", provider: "claude", model: "opus" },
        {
          id: "legacy_favorite:codex:gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          provider: "codex",
          model: "gpt-5.6-sol",
        },
      ]);
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewChat(page);
      await expectComposerVisible(page);

      await test.step("both favorites are pinned and can switch providers in either direction", async () => {
        await openModelPicker(page);
        await expectProfilePinnedAboveProviders(page, { name: "Opus", summary: "Claude · Opus" });
        await expectProfilePinnedAboveProviders(page, {
          name: "GPT-5.6 Sol",
          summary: "Codex · GPT-5.6 Sol",
        });
        await page.screenshot({ path: testInfo.outputPath("claude-codex-favorites.png") });
        await applyProfileFromPicker(page, "Opus");
        await expectComposerModel(page, "Opus");
        await openModelPicker(page);
        await applyProfileFromPicker(page, "GPT-5.6 Sol");
        await expectComposerModel(page, "GPT-5.6 Sol");
        await reloadSavedDraft(page);
        await expectComposerModel(page, "GPT-5.6 Sol");
      });

      await test.step("search reaches both providers and clearing it restores both favorites", async () => {
        await page.getByRole("textbox", { name: "Message agent..." }).first().focus();
        await page.keyboard.press("Alt+m");
        await searchAllModels(page, "Claude Opus");
        await expectModelSearchResult(page, {
          provider: "claude",
          modelId: "opus",
          providerLabel: "Claude",
          modelLabel: "Opus",
        });
        await page.getByTestId("model-row-claude-opus").click();
        await expectComposerModel(page, "Opus");
        await openModelPicker(page);
        await searchAllModels(page, "Codex Sol");
        await expectModelSearchResult(page, {
          provider: "codex",
          modelId: "gpt-5.6-sol",
          providerLabel: "Codex",
          modelLabel: "GPT-5.6 Sol",
        });
        await page.screenshot({ path: testInfo.outputPath("claude-codex-search.png") });
        await page.getByTestId("model-row-codex-gpt-5.6-sol").click();
        await expectComposerModel(page, "GPT-5.6 Sol");
        await openModelPicker(page);
        await searchAllModels(page, "Codex Sol");
        await expectModelRowSelected(page, { provider: "codex", modelId: "gpt-5.6-sol" });
        await searchAllModels(page, "zzz");
        await expectModelSearchEmptyState(page, "zzz");
        await searchAllModels(page, "");
        await expectProfilePinnedAboveProviders(page, { name: "Opus", summary: "Claude · Opus" });
        await expectProfilePinnedAboveProviders(page, {
          name: "GPT-5.6 Sol",
          summary: "Codex · GPT-5.6 Sol",
        });
        await applyProfileFromPicker(page, "Opus");
        await expectComposerModel(page, "Opus");
      });
    } finally {
      await workspace.cleanup();
      await profiles.restore();
      await client.patchDaemonConfig({ removeProviders: ["claude", "codex"] });
      await client.patchDaemonConfig({ providers: previous.config.providers });
      await client.close();
    }
  });

  test("switches providers directly after reopening a picker without profiles", async ({
    page,
  }, testInfo) => {
    const provider = await seedModelProvider(STUDIO);
    const profiles = await seedAgentProfiles([]);
    const workspace = await seedWorkspace({ repoPrefix: "model-switch-direct-" });
    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewChat(page);
      await expectComposerVisible(page);
      await page.getByRole("textbox", { name: "Message agent..." }).first().focus();
      await page.keyboard.press("Alt+m");
      await expect(page.getByTestId("model-search-all-input")).toBeFocused();
      await page.mouse.move(1100, 100);
      await page.screenshot({ path: testInfo.outputPath("all-provider-models.png") });
      await page.keyboard.type("studio deep");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await expect(
        page.getByTestId("combined-model-selector").filter({ visible: true }).first(),
      ).toContainText("Studio deep think");
      await page.getByRole("textbox", { name: "Message agent..." }).first().focus();
      await page.keyboard.press("Alt+m");
      await expect(page.getByTestId("model-search-all-input")).toBeVisible();
      await searchAllModels(page, "ten second stream");
      await expectModelSearchResult(page, {
        provider: "mock",
        modelId: "ten-second-stream",
        modelLabel: "Ten second stream",
        providerLabel: MOCK_PROVIDER_LABEL,
      });
      await page.screenshot({ path: testInfo.outputPath("direct-model-switch.png") });
      await page.getByTestId("model-row-mock-ten-second-stream").click();
      await expect(
        page.getByTestId("combined-model-selector").filter({ visible: true }).first(),
      ).toContainText("Ten second stream");
    } finally {
      await workspace.cleanup();
      await profiles.restore();
      await provider.restore();
    }
  });

  test("one query over the picker root reaches every provider and names each result's provider", async ({
    page,
  }) => {
    const provider = await seedModelProvider(STUDIO);
    const profile = await seedAgentProfiles([ROOT_VIEW_PROFILE]);
    const workspace = await seedWorkspace({ repoPrefix: "model-search-providers-" });

    try {
      await test.step("open a draft composer that can reach every provider", async () => {
        await gotoWorkspace(page, workspace.workspaceId);
        await clickNewChat(page);
        await expectComposerVisible(page);
        await openModelPicker(page);
      });
      const restingWidth = await readModelPickerWidth(page);

      await test.step("one query returns the same model label from two providers", async () => {
        await searchAllModels(page, "ten second stream");
        await expectModelSearchResult(page, {
          provider: "mock",
          modelId: "ten-second-stream",
          modelLabel: "Ten second stream",
          providerLabel: MOCK_PROVIDER_LABEL,
        });
        await expectModelSearchResult(page, {
          provider: STUDIO.id,
          modelId: "studio-fast",
          modelLabel: "Ten second stream",
          providerLabel: STUDIO.label,
        });
        await expectModelPickerWidth(page, restingWidth);
      });

      await test.step("searching by provider name reaches that provider's own models", async () => {
        await searchAllModels(page, "studio deep");
        await expectModelSearchResult(page, {
          provider: STUDIO.id,
          modelId: "studio-deep",
          modelLabel: "Studio deep think",
          providerLabel: STUDIO.label,
        });
      });

      await test.step("results replace the pinned profiles", async () => {
        await expectPinnedProfilesHidden(page);
      });

      // Search falls back to subsequence matching, so "no matches" needs letters
      // that cannot be picked out of a model label or description in order.
      await test.step("a query with no matches repeats the query back", async () => {
        await searchAllModels(page, "zzz");
        await expectModelSearchEmptyState(page, "zzz");
        await closeModelPicker(page);
      });
    } finally {
      await workspace.cleanup();
      await profile.restore();
      await provider.restore();
    }
  });

  test("desktop search keeps its frame stable and virtualizes a host-wide catalog", async ({
    page,
  }) => {
    const provider = await seedModelProvider(LARGE_CATALOG);
    const profile = await seedAgentProfiles([ROOT_VIEW_PROFILE]);
    const workspace = await seedWorkspace({ repoPrefix: "model-search-large-catalog-" });

    try {
      await test.step("open the host-wide model picker", async () => {
        await gotoWorkspace(page, workspace.workspaceId);
        await clickNewChat(page);
        await expectComposerVisible(page);
        await openModelPicker(page);
      });

      const restingHeight = await readModelPickerHeight(page);
      const restingWidth = await readModelPickerWidth(page);

      await test.step("a broad query renders only the visible result window", async () => {
        await searchAllModels(page, "bulk model");
        await expectSearchResultsVirtualized(page, {
          provider: LARGE_CATALOG.id,
          total: LARGE_CATALOG_SIZE,
        });
        await expectModelPickerHeight(page, restingHeight);
        await expectModelPickerWidth(page, restingWidth);
      });

      await test.step("narrowing to one result does not resize the picker", async () => {
        await searchAllModels(page, "bulk model 199");
        await expectModelSearchResult(page, {
          provider: LARGE_CATALOG.id,
          modelId: "bulk-199",
          modelLabel: "Bulk model 199",
          providerLabel: LARGE_CATALOG.label,
        });
        await expectModelPickerHeight(page, restingHeight);
        await expectModelPickerWidth(page, restingWidth);
      });
    } finally {
      await workspace.cleanup();
      await profile.restore();
      await provider.restore();
    }
  });
});

async function setRuntimeCatalog(client: DaemonClient, count: number, cwd: string) {
  await client.patchDaemonConfig({
    providers: {
      gemini: {
        extends: "acp",
        label: "Catalog provider",
        enabled: true,
        command: [
          process.execPath,
          path.resolve(__dirname, "../support/fixtures/catalog-acp.cjs"),
          String(count),
        ],
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await client.getProvidersSnapshot({ cwd })).entries.find(
          (entry) => entry.provider === "gemini",
        )?.status,
      { timeout: 30_000 },
    )
    .toBe("ready");
}
async function reloadSavedDraft(page: Page) {
  await page.evaluate(() =>
    localStorage.setItem(
      "@paseo:e2e-disable-default-seed-once",
      localStorage.getItem("@paseo:e2e-seed-nonce")!,
    ),
  );
  await page.reload();
  await expectComposerVisible(page);
}
async function expectOneCatalogChoice(page: Page, label: string) {
  await openModelPicker(page);
  await searchAllModels(page, label);
  await expect(page.getByTestId("model-row-gemini-gemini-3.5-flash")).toHaveCount(1);
  await closeModelPicker(page);
}

async function configureModelOverride(client: DaemonClient, cwd: string) {
  await client.patchDaemonConfig({
    providers: {
      gemini: {
        additionalModels: [{ id: "gemini-3.5-flash", label: "Configured model", isDefault: true }],
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await client.getProvidersSnapshot({ cwd: cwd })).entries.find(
          (entry) => entry.provider === "gemini",
        )?.models,
      { timeout: 30_000 },
    )
    .toMatchObject([{ id: "gemini-3.5-flash", label: "Configured model", isDefault: true }]);
}

const catalogTest = test.extend<{ catalogClient: DaemonClient }>({
  catalogClient: async ({ e2eWorker }, provide) => {
    void e2eWorker;
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "catalog-models" });
    try {
      await provide(client);
    } finally {
      try {
        await client.patchDaemonConfig({ removeProviders: ["gemini"] });
      } finally {
        await client.close();
      }
    }
  },
});

catalogTest(
  "New Agent and saved drafts stay usable with repeated runtime model rows",
  async ({ page, withWorkspace, catalogClient: client }, testInfo) => {
    const workspace = await withWorkspace({ prefix: "catalog-models-" });
    await test.step("open a draft with a one-row runtime catalog", async () => {
      await setRuntimeCatalog(client, 1, workspace.repoPath);
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewChat(page);
      await expectComposerVisible(page);
    });
    await test.step("open New Agent after the provider publishes repeated model rows", async () => {
      await clickNewTerminal(page);
      await setRuntimeCatalog(client, 2, workspace.repoPath);
      await clickNewChat(page);
      await expectComposerVisible(page);
      await expectOneCatalogChoice(page, "Gemini 3.5 Flash");
      await page.screenshot({ path: testInfo.outputPath("duplicate-catalog-draft.png") });
    });
    await test.step("reopen the saved draft with the same catalog", async () => {
      await reloadSavedDraft(page);
      await expectOneCatalogChoice(page, "Gemini 3.5 Flash");
    });
    await test.step("retain configured model overrides when runtime IDs repeat", async () => {
      await configureModelOverride(client, workspace.repoPath);
      await reloadSavedDraft(page);
      await expectOneCatalogChoice(page, "Configured model");
    });
  },
);
