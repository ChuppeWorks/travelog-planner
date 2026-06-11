import {
  App,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import {
  applyRouteDelay,
  compareTimelineItems,
  clone,
  createEmptyDataset,
  ensureBaseline,
  freezeTripBaseline,
  newId,
  nowIso,
  placeDisplayName,
  scheduleWarnings,
  shiftItemAndFollowing,
  syncTripDateRange,
  timeInZone,
  updateTravelDay,
  validateDataset,
  zonedLocalToIso,
  type TimelineItem,
  type TransportMode,
  type OpeningPeriod,
  type PlaceNameDisplayPreference,
  type ScheduleWarning,
  type TravelDay,
  type TravelogDataset,
  type Trip,
} from "../../../packages/schema/src";
import { datasetToNotionTables, NOTION_TABLE_FILES } from "../../../packages/interchange/src";
import {
  LANGUAGE_OPTIONS,
  isRtlLanguage,
  resolveLanguage,
  translate,
  type LanguageSetting,
  type TranslationKey,
} from "./i18n";

const VIEW_TYPE = "travelog-planner-view";

interface TravelogSettings {
  dataPath: string;
  language: LanguageSetting;
  travelogWebAppUrl: string;
}

const DEFAULT_SETTINGS: TravelogSettings = {
  dataPath: "Travelog/travelog.json",
  language: "auto",
  travelogWebAppUrl: "",
};

export default class TravelogPlannerPlugin extends Plugin {
  settings: TravelogSettings = DEFAULT_SETTINGS;
  store!: TravelogStore;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.store = new TravelogStore(this.app, this.settings.dataPath);
    await this.store.load();

    this.registerView(VIEW_TYPE, (leaf) => new TravelogPlannerView(leaf, this));
    this.addRibbonIcon("map", this.t("app.name"), () => void this.activateView());
    this.addCommand({
      id: "open-planner",
      name: this.t("command.open"),
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "create-trip",
      name: this.t("command.createTrip"),
      callback: () => new CreateTripModal(this.app, this).open(),
    });
    this.addCommand({
      id: "export-notion-csv",
      name: this.t("command.exportNotion"),
      callback: () => void this.exportNotionCsv(),
    });
    this.addSettingTab(new TravelogSettingTab(this.app, this));
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async refreshViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof TravelogPlannerView) await view.render();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.store = new TravelogStore(this.app, this.settings.dataPath);
    await this.store.load();
    await this.refreshViews();
  }

  t(key: TranslationKey, values: Record<string, string | number> = {}): string {
    return translate(this.settings.language, key, values, globalThis.navigator?.language ?? "en");
  }

  applyDirection(element: HTMLElement): void {
    element.setAttr(
      "dir",
      isRtlLanguage(this.settings.language, globalThis.navigator?.language ?? "en") ? "rtl" : "ltr",
    );
  }

  openUpsell(feature: "map" | "transit", context: UpsellContext = {}): void {
    new TravelogUpsellModal(this.app, this, feature, context).open();
  }

  async exportNotionCsv(): Promise<void> {
    const parent = normalizePath(this.settings.dataPath).split("/").slice(0, -1).join("/");
    const directory = normalizePath(`${parent || "Travelog"}/notion-export`);
    await ensureFolder(this.app, directory);
    const tables = datasetToNotionTables(this.store.dataset);
    for (const [table, filename] of Object.entries(NOTION_TABLE_FILES)) {
      await this.app.vault.adapter.write(`${directory}/${filename}`, tables[table as keyof typeof tables]);
    }
    new Notice(this.t("notice.exported", { directory }));
  }
}

interface UpsellContext {
  tripId?: string;
  dayId?: string;
  route?: TimelineItem;
}

class TravelogStore {
  dataset: TravelogDataset = createEmptyDataset();

  constructor(
    private app: App,
    private dataPath: string,
  ) {}

  async load(): Promise<void> {
    const path = normalizePath(this.dataPath);
    if (!(await this.app.vault.adapter.exists(path))) {
      await this.save();
      return;
    }
    const parsed = JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
    const validation = validateDataset(parsed);
    if (!validation.valid) throw new Error(`Invalid Travelog data: ${validation.errors.join(" ")}`);
    this.dataset = parsed as TravelogDataset;
  }

  async save(): Promise<void> {
    const path = normalizePath(this.dataPath);
    await this.ensureParentFolder(path);
    this.dataset.exportedAt = nowIso();
    await this.app.vault.adapter.write(path, `${JSON.stringify(this.dataset, null, 2)}\n`);
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const parts = path.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.adapter.mkdir(current);
    }
  }
}

class TravelogPlannerView extends ItemView {
  private selectedTripId: string | undefined;
  private selectedDayId: string | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: TravelogPlannerPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.t("app.name");
  }

  getIcon(): string {
    return "map";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("travelog-planner");
    this.plugin.applyDirection(container);

    const dataset = this.plugin.store.dataset;
    this.normalizeSelection(dataset);

    const header = container.createDiv({ cls: "travelog-planner__header" });
    header.createEl("h2", { text: this.plugin.t("app.name") });
    this.button(header, this.plugin.t("button.newTrip"), () => new CreateTripModal(this.app, this.plugin).open());

    if (!dataset.trips.length) {
      container.createDiv({
        cls: "travelog-planner__empty",
        text: this.plugin.t("empty.noTrips"),
      });
      return;
    }

    const selectors = container.createDiv({ cls: "travelog-planner__toolbar" });
    this.select(
      selectors,
      dataset.trips.map((trip) => ({ value: trip.id, label: trip.name })),
      this.selectedTripId!,
      (value) => {
        this.selectedTripId = value;
        this.selectedDayId = undefined;
        void this.render();
      },
    );
    const selectedTrip = dataset.trips.find((trip) => trip.id === this.selectedTripId)!;
    this.button(selectors, this.plugin.t("button.editTrip"), () =>
      new EditTripModal(this.app, this.plugin, selectedTrip).open(),
    );
    const days = dataset.days
      .filter((day) => day.tripId === this.selectedTripId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    this.select(
      selectors,
      days.map((day) => ({ value: day.id, label: `${day.date}${day.title ? ` - ${day.title}` : ""}` })),
      this.selectedDayId!,
      (value) => {
        this.selectedDayId = value;
        void this.render();
      },
    );
    const selectedDay = days.find((day) => day.id === this.selectedDayId);
    if (selectedDay) {
      this.button(selectors, this.plugin.t("button.editDay"), () =>
        new EditDayModal(this.app, this.plugin, selectedDay).open(),
      );
    }

    const toolbar = container.createDiv({ cls: "travelog-planner__toolbar" });
    this.button(toolbar, this.plugin.t("button.addPoint"), () => this.openItemModal("point"));
    this.button(toolbar, this.plugin.t("button.addRoute"), () => this.openItemModal("route"));
    this.button(toolbar, this.plugin.t("button.viewMap"), () => this.openDayMap());
    this.button(toolbar, this.plugin.t("button.freezeBaseline"), () => void this.freezeBaseline());
    this.button(toolbar, this.plugin.t("button.exportNotion"), () => void this.plugin.exportNotionCsv());

    const dayItems = dataset.timelineItems.filter((item) => item.dayId === this.selectedDayId);
    const pointCount = dayItems.filter((item) => item.kind === "point").length;
    const routeCount = dayItems.filter((item) => item.kind === "route").length;
    const plannedExpenses = dataset.expenses.filter(
      (expense) => expense.dayId === this.selectedDayId && expense.phase === "planned",
    );
    const totals = Object.entries(
      plannedExpenses.reduce<Record<string, number>>((sum, expense) => {
        sum[expense.currency] = (sum[expense.currency] ?? 0) + expense.amount;
        return sum;
      }, {}),
    )
      .map(([currency, amount]) => `${amount} ${currency}`)
      .join(" + ");
    container.createDiv({
      cls: "travelog-planner__muted",
      text: this.plugin.t("summary.counts", {
        points: pointCount,
        routes: routeCount,
        planned: totals ? this.plugin.t("summary.planned", { totals }) : "",
      }),
    });

    const warnings = scheduleWarnings(dataset, this.selectedDayId!);
    if (warnings.length) {
      const warningBox = container.createDiv({ cls: "travelog-planner__warnings" });
      warningBox.createEl("strong", { text: this.plugin.t("warning.count", { count: warnings.length }) });
      const list = warningBox.createEl("ul");
      for (const warning of warnings) list.createEl("li", { text: localizedWarning(this.plugin, dataset, warning) });
    }

    const timeline = container.createDiv({ cls: "travelog-planner__timeline" });
    const items = dataset.timelineItems
      .filter((item) => item.dayId === this.selectedDayId)
      .sort(compareTimelineItems);
    if (!items.length) {
      timeline.createDiv({ cls: "travelog-planner__empty", text: this.plugin.t("empty.noItems") });
      return;
    }
    for (const item of items) this.renderItem(timeline, item);
  }

  private renderItem(container: HTMLElement, item: TimelineItem): void {
    const card = container.createDiv({
      cls: `travelog-planner__item travelog-planner__item--${item.kind}`,
    });
    const header = card.createDiv({ cls: "travelog-planner__item-header" });
    header.createEl("strong", {
      text: item.kind === "point"
        ? placeDisplayName(item.place, resolveLanguage(this.plugin.settings.language, globalThis.navigator?.language ?? "en"))
        : item.title,
    });
    header.createSpan({
      cls: "travelog-planner__kind",
      text: this.plugin.t(item.kind === "point" ? "item.pointKind" : "item.routeKind"),
    });

    card.createDiv({ text: formatWindow(item.schedule.current, this.plugin.t("item.unscheduled")) });
    if (item.schedule.baseline) {
      card.createDiv({
        cls: "travelog-planner__muted",
        text: this.plugin.t("item.baseline", {
          window: formatWindow(item.schedule.baseline, this.plugin.t("item.unscheduled")),
        }),
      });
    }
    if (item.kind === "point") {
      const detail = [item.place.address, item.place.openingHoursText].filter(Boolean).join(" | ");
      if (detail) card.createDiv({ cls: "travelog-planner__muted", text: detail });
      if (item.place.coordinates) {
        card.createDiv({
          cls: "travelog-planner__muted",
          text: `${item.place.coordinates.latitude}, ${item.place.coordinates.longitude}`,
        });
      }
      const mapLink = card.createEl("a", {
        text: this.plugin.t(item.place.coordinates ? "button.openCoordinates" : "button.searchMaps"),
        href: item.place.coordinates
          ? `https://www.google.com/maps/search/?api=1&query=${item.place.coordinates.latitude},${item.place.coordinates.longitude}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.place.address ?? item.place.name)}`,
      });
      mapLink.setAttr("target", "_blank");
    } else {
      const detail = [item.route.mode, item.route.lineName, item.route.operator].filter(Boolean).join(" | ");
      card.createDiv({ cls: "travelog-planner__muted", text: detail });
      if (item.route.delayMinutes) {
        card.createDiv({
          cls: "travelog-planner__muted",
          text: this.plugin.t("item.delay", { minutes: item.route.delayMinutes }),
        });
      }
      if (item.route.fare) {
        card.createDiv({
          cls: "travelog-planner__muted",
          text: this.plugin.t("item.fare", {
            amount: item.route.fare.amount,
            currency: item.route.fare.currency,
          }),
        });
      }
    }
    if (item.notes) card.createEl("p", { text: item.notes });

    const checklist = this.plugin.store.dataset.checklistItems
      .filter((candidate) => candidate.timelineItemId === item.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (checklist.length) {
      const list = card.createEl("ul");
      for (const checklistItem of checklist) {
        const row = list.createEl("li");
        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.checked = checklistItem.completed;
        checkbox.addEventListener("change", () => void this.toggleChecklist(checklistItem.id, checkbox.checked));
        row.createSpan({ text: ` ${checklistItem.label}` });
      }
    }
    const expenses = this.plugin.store.dataset.expenses.filter(
      (candidate) => candidate.timelineItemId === item.id && candidate.phase === "planned",
    );
    if (expenses.length) {
      card.createDiv({
        cls: "travelog-planner__muted",
        text: this.plugin.t("item.plannedCost", {
          costs: expenses.map((expense) => `${expense.amount} ${expense.currency}`).join(" + "),
        }),
      });
    }

    const actions = card.createDiv({ cls: "travelog-planner__item-actions" });
    this.button(actions, this.plugin.t("button.shiftBack"), () => void this.shift(item.id, -15));
    this.button(actions, this.plugin.t("button.shiftForward"), () => void this.shift(item.id, 15));
    if (item.kind === "route") {
      this.button(actions, this.plugin.t("button.applyDelay"), () => void this.delayRoute(item.id, 15));
      this.button(actions, this.plugin.t("button.findTransit"), () =>
        this.plugin.openUpsell("transit", { tripId: item.tripId, dayId: item.dayId, route: item }),
      );
    }
    this.button(actions, this.plugin.t("button.edit"), () => new EditItemModal(this.app, this.plugin, item).open());
    this.button(actions, this.plugin.t("button.delete"), () => void this.deleteItem(item.id));
  }

  private openItemModal(kind: "point" | "route"): void {
    const day = this.plugin.store.dataset.days.find((candidate) => candidate.id === this.selectedDayId);
    const trip = this.plugin.store.dataset.trips.find((candidate) => candidate.id === this.selectedTripId);
    if (!day || !trip) return;
    new CreateItemModal(this.app, this.plugin, trip, day, kind).open();
  }

  private openDayMap(): void {
    this.plugin.openUpsell("map", {
      ...(this.selectedTripId ? { tripId: this.selectedTripId } : {}),
      ...(this.selectedDayId ? { dayId: this.selectedDayId } : {}),
    });
  }

  private async freezeBaseline(): Promise<void> {
    const count = freezeTripBaseline(this.plugin.store.dataset, this.selectedTripId!);
    await this.plugin.store.save();
    new Notice(this.plugin.t("notice.baselineFrozen", { count }));
    await this.plugin.refreshViews();
  }

  private async shift(itemId: string, minutes: number): Promise<void> {
    const count = shiftItemAndFollowing(this.plugin.store.dataset, itemId, minutes);
    await this.plugin.store.save();
    new Notice(this.plugin.t("notice.shifted", { count, minutes }));
    await this.plugin.refreshViews();
  }

  private async delayRoute(itemId: string, minutes: number): Promise<void> {
    const count = applyRouteDelay(this.plugin.store.dataset, itemId, minutes);
    await this.plugin.store.save();
    new Notice(this.plugin.t("notice.delayApplied", { count, minutes }));
    await this.plugin.refreshViews();
  }

  private async deleteItem(itemId: string): Promise<void> {
    const dataset = this.plugin.store.dataset;
    dataset.timelineItems = dataset.timelineItems.filter((item) => item.id !== itemId);
    dataset.checklistItems = dataset.checklistItems.filter((item) => item.timelineItemId !== itemId);
    dataset.expenses = dataset.expenses.filter((item) => item.timelineItemId !== itemId);
    dataset.attachments = dataset.attachments.filter((item) => item.timelineItemId !== itemId);
    await this.plugin.store.save();
    await this.plugin.refreshViews();
  }

  private async toggleChecklist(checklistItemId: string, completed: boolean): Promise<void> {
    const item = this.plugin.store.dataset.checklistItems.find((candidate) => candidate.id === checklistItemId);
    if (!item) return;
    item.completed = completed;
    await this.plugin.store.save();
    await this.plugin.refreshViews();
  }

  private normalizeSelection(dataset: TravelogDataset): void {
    if (!dataset.trips.some((trip) => trip.id === this.selectedTripId)) this.selectedTripId = dataset.trips[0]?.id;
    const days = dataset.days
      .filter((day) => day.tripId === this.selectedTripId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (!days.some((day) => day.id === this.selectedDayId)) this.selectedDayId = days[0]?.id;
  }

  private button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { text: label });
    button.addEventListener("click", onClick);
    return button;
  }

  private select(
    parent: HTMLElement,
    options: Array<{ value: string; label: string }>,
    value: string,
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const select = parent.createEl("select");
    for (const option of options) {
      const element = select.createEl("option", { text: option.label, value: option.value });
      element.selected = option.value === value;
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }
}

class CreateTripModal extends Modal {
  private name = "";
  private startDate = today();
  private endDate = today();
  private timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  private baseCurrency = "USD";
  private destinations = "";

  constructor(
    app: App,
    private plugin: TravelogPlannerPlugin,
  ) {
    super(app);
  }

  onOpen(): void {
    this.plugin.applyDirection(this.contentEl);
    this.contentEl.createEl("h2", { text: this.plugin.t("modal.createTrip") });
    textSetting(this.contentEl, this.plugin.t("field.name"), "", (value) => (this.name = value));
    textSetting(
      this.contentEl,
      this.plugin.t("field.startDate"),
      this.startDate,
      (value) => (this.startDate = value),
      "date",
    );
    textSetting(
      this.contentEl,
      this.plugin.t("field.endDate"),
      this.endDate,
      (value) => (this.endDate = value),
      "date",
    );
    textSetting(this.contentEl, this.plugin.t("field.timeZone"), this.timeZone, (value) => (this.timeZone = value));
    textSetting(
      this.contentEl,
      this.plugin.t("field.baseCurrency"),
      this.baseCurrency,
      (value) => (this.baseCurrency = value.toUpperCase()),
    );
    textSetting(
      this.contentEl,
      this.plugin.t("field.destinations"),
      "",
      (value) => (this.destinations = value),
      "text",
      this.plugin.t("desc.destinations"),
    );
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(this.plugin.t("button.create"))
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    if (!this.name.trim() || !validDateRange(this.startDate, this.endDate) || !validTimeZone(this.timeZone)) {
      new Notice(this.plugin.t("notice.invalidTrip"));
      return;
    }
    const dataset = this.plugin.store.dataset;
    const timestamp = nowIso();
    const trip: Trip = {
      id: newId("trip"),
      name: this.name.trim(),
      status: "planning",
      startDate: this.startDate,
      endDate: this.endDate,
      timeZone: this.timeZone,
      baseCurrency: this.baseCurrency || "USD",
      destinations: splitList(this.destinations),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    dataset.trips.push(trip);
    dataset.days.push(...createDays(trip));
    await this.plugin.store.save();
    await this.plugin.refreshViews();
    this.close();
  }
}

class EditTripModal extends Modal {
  private name: string;
  private status: Trip["status"];
  private startDate: string;
  private endDate: string;
  private timeZone: string;
  private baseCurrency: string;
  private destinations: string;
  private notes: string;

  constructor(
    app: App,
    private plugin: TravelogPlannerPlugin,
    private trip: Trip,
  ) {
    super(app);
    this.name = trip.name;
    this.status = trip.status;
    this.startDate = trip.startDate;
    this.endDate = trip.endDate;
    this.timeZone = trip.timeZone;
    this.baseCurrency = trip.baseCurrency;
    this.destinations = trip.destinations.join(", ");
    this.notes = trip.notes ?? "";
  }

  onOpen(): void {
    this.plugin.applyDirection(this.contentEl);
    this.contentEl.createEl("h2", { text: this.plugin.t("modal.editTrip") });
    textSetting(this.contentEl, this.plugin.t("field.name"), this.name, (value) => (this.name = value));
    dropdownSetting(
      this.contentEl,
      this.plugin.t("field.status"),
      tripStatuses,
      this.status,
      (value) => (this.status = value as Trip["status"]),
      (value) => this.plugin.t(`status.${value}` as TranslationKey),
    );
    textSetting(
      this.contentEl,
      this.plugin.t("field.startDate"),
      this.startDate,
      (value) => (this.startDate = value),
      "date",
      this.plugin.t("desc.tripRange"),
    );
    textSetting(
      this.contentEl,
      this.plugin.t("field.endDate"),
      this.endDate,
      (value) => (this.endDate = value),
      "date",
    );
    textSetting(this.contentEl, this.plugin.t("field.timeZone"), this.timeZone, (value) => (this.timeZone = value));
    textSetting(
      this.contentEl,
      this.plugin.t("field.baseCurrency"),
      this.baseCurrency,
      (value) => (this.baseCurrency = value.toUpperCase()),
    );
    textSetting(
      this.contentEl,
      this.plugin.t("field.destinations"),
      this.destinations,
      (value) => (this.destinations = value),
      "text",
      this.plugin.t("desc.destinations"),
    );
    textAreaSetting(this.contentEl, this.plugin.t("field.notes"), this.notes, (value) => (this.notes = value));
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(this.plugin.t("button.save"))
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    if (!this.name.trim() || !validDateRange(this.startDate, this.endDate) || !validTimeZone(this.timeZone)) {
      new Notice(this.plugin.t("notice.invalidTrip"));
      return;
    }
    const dataset = this.plugin.store.dataset;
    const before = clone(this.trip);
    const sync = syncTripDateRange(dataset, this.trip.id, this.startDate, this.endDate, this.timeZone);
    if (sync.blockedDates.length) {
      new Notice(this.plugin.t("notice.tripRangeHasContent", { dates: sync.blockedDates.join(", ") }));
      return;
    }
    this.trip.name = this.name.trim();
    this.trip.status = this.status;
    this.trip.startDate = this.startDate;
    this.trip.endDate = this.endDate;
    this.trip.timeZone = this.timeZone;
    this.trip.baseCurrency = this.baseCurrency.trim().toUpperCase() || "USD";
    this.trip.destinations = splitList(this.destinations);
    if (this.notes.trim()) this.trip.notes = this.notes.trim();
    else delete this.trip.notes;
    this.trip.updatedAt = nowIso();
    dataset.planChanges.push({
      id: newId("change"),
      tripId: this.trip.id,
      entityType: "trip",
      entityId: this.trip.id,
      changedAt: nowIso(),
      source: "user",
      reason: "Edited trip in Obsidian",
      before: before as unknown as Record<string, unknown>,
      after: clone(this.trip) as unknown as Record<string, unknown>,
    });
    await this.plugin.store.save();
    await this.plugin.refreshViews();
    new Notice(this.plugin.t("notice.tripUpdated"));
    this.close();
  }
}

class EditDayModal extends Modal {
  private date: string;
  private title: string;
  private timeZone: string;
  private notes: string;

  constructor(
    app: App,
    private plugin: TravelogPlannerPlugin,
    private day: TravelDay,
  ) {
    super(app);
    this.date = day.date;
    this.title = day.title ?? "";
    this.timeZone = day.timeZone;
    this.notes = day.notes ?? "";
  }

  onOpen(): void {
    this.plugin.applyDirection(this.contentEl);
    this.contentEl.createEl("h2", { text: this.plugin.t("modal.editDay") });
    textSetting(this.contentEl, this.plugin.t("field.date"), this.date, (value) => (this.date = value), "date");
    textSetting(this.contentEl, this.plugin.t("field.title"), this.title, (value) => (this.title = value));
    textSetting(this.contentEl, this.plugin.t("field.timeZone"), this.timeZone, (value) => (this.timeZone = value));
    textAreaSetting(this.contentEl, this.plugin.t("field.notes"), this.notes, (value) => (this.notes = value));
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(this.plugin.t("button.save"))
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    if (!validIsoDate(this.date) || !validTimeZone(this.timeZone)) {
      new Notice(this.plugin.t("notice.invalidDay"));
      return;
    }
    const duplicate = this.plugin.store.dataset.days.some(
      (candidate) =>
        candidate.tripId === this.day.tripId && candidate.id !== this.day.id && candidate.date === this.date,
    );
    if (duplicate) {
      new Notice(this.plugin.t("notice.duplicateDay", { date: this.date }));
      return;
    }
    try {
      updateTravelDay(
        this.plugin.store.dataset,
        this.day.id,
        {
          date: this.date,
          timeZone: this.timeZone,
          ...(this.title.trim() ? { title: this.title.trim() } : {}),
          ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
        },
        "Edited day in Obsidian",
      );
    } catch {
      new Notice(this.plugin.t("notice.invalidDay"));
      return;
    }
    await this.plugin.store.save();
    await this.plugin.refreshViews();
    new Notice(this.plugin.t("notice.dayUpdated"));
    this.close();
  }
}

class CreateItemModal extends Modal {
  private title = "";
  private originalName = "";
  private localizedName = "";
  private localizedLanguage = "";
  private nameDisplayPreference: PlaceNameDisplayPreference = "custom";
  private start = "";
  private end = "";
  private notes = "";
  private address = "";
  private latitude = "";
  private longitude = "";
  private opens = "";
  private closes = "";
  private mode: TransportMode = "walk";
  private lineName = "";
  private operator = "";
  private delayMinutes = "";
  private fromPointId = "";
  private toPointId = "";
  private plannedCost = "";
  private checklist = "";

  constructor(
    app: App,
    private plugin: TravelogPlannerPlugin,
    private trip: Trip,
    private day: TravelDay,
    private kind: "point" | "route",
  ) {
    super(app);
    this.localizedLanguage = resolveLanguage(plugin.settings.language, globalThis.navigator?.language ?? "en");
  }

  onOpen(): void {
    this.plugin.applyDirection(this.contentEl);
    const localizedKind = this.plugin.t(this.kind === "point" ? "item.point" : "item.route");
    this.contentEl.createEl("h2", { text: this.plugin.t("modal.addItem", { kind: localizedKind }) });
    textSetting(this.contentEl, this.plugin.t("field.title"), "", (value) => (this.title = value));
    textSetting(this.contentEl, this.plugin.t("field.start"), "", (value) => (this.start = value), "time");
    textSetting(this.contentEl, this.plugin.t("field.end"), "", (value) => (this.end = value), "time");
    if (this.kind === "point") {
      textSetting(this.contentEl, this.plugin.t("field.originalName"), "", (value) => (this.originalName = value), "text", this.plugin.t("desc.placeNames"));
      textSetting(this.contentEl, this.plugin.t("field.localizedName"), "", (value) => (this.localizedName = value));
      textSetting(this.contentEl, this.plugin.t("field.localizedLanguage"), this.localizedLanguage, (value) => (this.localizedLanguage = value));
      dropdownSetting(
        this.contentEl,
        this.plugin.t("field.nameDisplay"),
        nameDisplayPreferences,
        this.nameDisplayPreference,
        (value) => (this.nameDisplayPreference = value as PlaceNameDisplayPreference),
        (value) => this.plugin.t(`nameDisplay.${value}` as TranslationKey),
      );
      textSetting(this.contentEl, this.plugin.t("field.address"), "", (value) => (this.address = value));
      textSetting(this.contentEl, this.plugin.t("field.latitude"), "", (value) => (this.latitude = value), "number");
      textSetting(this.contentEl, this.plugin.t("field.longitude"), "", (value) => (this.longitude = value), "number");
      textSetting(this.contentEl, this.plugin.t("field.opens"), "", (value) => (this.opens = value), "time", this.plugin.t("desc.openingHours"));
      textSetting(this.contentEl, this.plugin.t("field.closes"), "", (value) => (this.closes = value), "time");
    } else {
      dropdownSetting(
        this.contentEl,
        this.plugin.t("field.mode"),
        transportModes,
        this.mode,
        (value) => (this.mode = value as TransportMode),
        (value) => this.plugin.t(`transport.${value}` as TranslationKey),
      );
      textSetting(this.contentEl, this.plugin.t("field.line"), "", (value) => (this.lineName = value));
      textSetting(this.contentEl, this.plugin.t("field.operator"), "", (value) => (this.operator = value));
      textSetting(
        this.contentEl,
        this.plugin.t("field.knownDelay"),
        "",
        (value) => (this.delayMinutes = value),
        "number",
      );
      const points = this.plugin.store.dataset.timelineItems.filter(
        (item) => item.dayId === this.day.id && item.kind === "point",
      );
      relationDropdownSetting(
        this.contentEl,
        this.plugin.t("field.fromPoint"),
        points,
        (value) => (this.fromPointId = value),
        "",
        this.plugin.t("relation.notLinked"),
      );
      relationDropdownSetting(
        this.contentEl,
        this.plugin.t("field.toPoint"),
        points,
        (value) => (this.toPointId = value),
        "",
        this.plugin.t("relation.notLinked"),
      );
    }
    textSetting(
      this.contentEl,
      this.plugin.t(this.kind === "route" ? "field.fare" : "field.plannedCost", {
        currency: this.trip.baseCurrency,
      }),
      "",
      (value) => (this.plannedCost = value),
      "number",
    );
    textSetting(
      this.contentEl,
      this.plugin.t("field.checklist"),
      "",
      (value) => (this.checklist = value),
      "text",
      this.plugin.t("desc.checklist"),
    );
    textAreaSetting(this.contentEl, this.plugin.t("field.notes"), "", (value) => (this.notes = value));
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(this.plugin.t("button.add"))
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    if (!this.title.trim()) {
      new Notice(this.plugin.t("notice.titleRequired"));
      return;
    }
    if (!validOpeningHours(this.opens, this.closes)) {
      new Notice(this.plugin.t("notice.invalidOpeningHours"));
      return;
    }
    const dataset = this.plugin.store.dataset;
    const timestamp = nowIso();
    const itemId = newId(this.kind);
    const amount = optionalNumber(this.plannedCost);
    const latitude = optionalNumber(this.latitude);
    const longitude = optionalNumber(this.longitude);
    const delayMinutes = optionalNumber(this.delayMinutes);
    const openingPeriod = createOpeningPeriod(this.day.date, this.opens, this.closes);
    const current = {
      start: zonedLocalToIso(this.day.date, this.start, this.day.timeZone),
      end: zonedLocalToIso(this.day.date, this.end, this.day.timeZone),
      timeZone: this.day.timeZone,
    };
    const common = {
      id: itemId,
      tripId: this.trip.id,
      dayId: this.day.id,
      sortOrder: nextSortOrder(dataset, this.day.id),
      title: this.title.trim(),
      schedule: { current },
      ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const item: TimelineItem =
      this.kind === "point"
        ? {
            ...common,
            kind: "point",
            place: {
              name: this.originalName.trim() || this.localizedName.trim() || this.title.trim(),
              customName: this.title.trim(),
              ...(this.originalName.trim() ? { originalName: { text: this.originalName.trim() } } : {}),
              ...(this.localizedName.trim() && this.localizedLanguage.trim()
                ? { localizedNames: [{ text: this.localizedName.trim(), languageCode: this.localizedLanguage.trim(), provider: "google-places" }] }
                : {}),
              nameDisplayPreference: this.nameDisplayPreference,
              ...(this.address.trim() ? { address: this.address.trim() } : {}),
              ...(validCoordinates(latitude, longitude) ? { coordinates: { latitude, longitude } } : {}),
              ...(openingPeriod ? { openingHoursText: `${openingPeriod.opens}-${openingPeriod.closes}` } : {}),
              ...(openingPeriod ? { openingPeriods: [openingPeriod] } : {}),
            },
          }
        : {
            ...common,
            kind: "route",
            route: {
              mode: this.mode,
              ...(this.lineName.trim() ? { lineName: this.lineName.trim() } : {}),
              ...(this.operator.trim() ? { operator: this.operator.trim() } : {}),
              ...(Number.isFinite(delayMinutes) && delayMinutes !== 0 ? { delayMinutes } : {}),
              ...(Number.isFinite(amount) && amount > 0
                ? { fare: { amount, currency: this.trip.baseCurrency } }
                : {}),
              ...(this.fromPointId ? { fromPointId: this.fromPointId } : {}),
              ...(this.toPointId ? { toPointId: this.toPointId } : {}),
            },
          };
    dataset.timelineItems.push(item);
    for (const [index, label] of splitList(this.checklist).entries()) {
      dataset.checklistItems.push({
        id: newId("check"),
        tripId: this.trip.id,
        dayId: this.day.id,
        timelineItemId: itemId,
        label,
        phase: "during",
        completed: false,
        sortOrder: index,
      });
    }
    if (Number.isFinite(amount) && amount > 0) {
      dataset.expenses.push({
        id: newId("expense"),
        tripId: this.trip.id,
        dayId: this.day.id,
        timelineItemId: itemId,
        phase: "planned",
        category: this.kind === "route" ? "transport" : "activity",
        amount,
        currency: this.trip.baseCurrency,
      });
    }
    await this.plugin.store.save();
    await this.plugin.refreshViews();
    this.close();
  }
}

class EditItemModal extends Modal {
  private title: string;
  private originalName = "";
  private localizedName = "";
  private localizedLanguage = "";
  private nameDisplayPreference: PlaceNameDisplayPreference = "custom";
  private start: string;
  private end: string;
  private notes: string;
  private detail: string;
  private latitude = "";
  private longitude = "";
  private opens = "";
  private closes = "";
  private mode: TransportMode = "walk";
  private operator = "";
  private delayMinutes = "";
  private fareAmount = "";
  private fareCurrency = "";
  private fromPointId = "";
  private toPointId = "";
  private plannedCost = "";
  private plannedCurrency = "";
  private checklist = "";

  constructor(
    app: App,
    private plugin: TravelogPlannerPlugin,
    private item: TimelineItem,
  ) {
    super(app);
    this.title = item.title;
    this.start = timeInput(item.schedule.current.start, item.schedule.current.timeZone);
    this.end = timeInput(item.schedule.current.end, item.schedule.current.timeZone);
    this.notes = item.notes ?? "";
    this.detail = item.kind === "point" ? item.place.address ?? "" : item.route.lineName ?? "";
    this.checklist = plugin.store.dataset.checklistItems
      .filter((candidate) => candidate.timelineItemId === item.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((candidate) => candidate.label)
      .join(", ");
    if (item.kind === "point") {
      this.originalName = item.place.originalName?.text ?? item.place.name;
      const localized = item.place.localizedNames?.find((name) => name.provider === "google-places") ?? item.place.localizedNames?.[0];
      this.localizedName = localized?.text ?? "";
      this.localizedLanguage = localized?.languageCode ?? resolveLanguage(plugin.settings.language, globalThis.navigator?.language ?? "en");
      this.nameDisplayPreference = item.place.nameDisplayPreference ?? "custom";
      this.latitude = item.place.coordinates ? String(item.place.coordinates.latitude) : "";
      this.longitude = item.place.coordinates ? String(item.place.coordinates.longitude) : "";
      const day = plugin.store.dataset.days.find((candidate) => candidate.id === item.dayId);
      const openingPeriod =
        openingPeriodForDate(item.place.openingPeriods, day?.date) ?? parseOpeningHoursText(item.place.openingHoursText);
      this.opens = openingPeriod?.opens ?? "";
      this.closes = openingPeriod?.closes ?? "";
      const plannedExpense = plugin.store.dataset.expenses.find(
        (candidate) =>
          candidate.timelineItemId === item.id &&
          candidate.phase === "planned" &&
          candidate.category === "activity",
      );
      this.plannedCost = plannedExpense ? String(plannedExpense.amount) : "";
      this.plannedCurrency = plannedExpense?.currency ?? "";
    } else {
      this.mode = item.route.mode;
      this.operator = item.route.operator ?? "";
      this.delayMinutes = item.route.delayMinutes === undefined ? "" : String(item.route.delayMinutes);
      this.fareAmount = item.route.fare ? String(item.route.fare.amount) : "";
      this.fareCurrency = item.route.fare?.currency ?? "";
      this.fromPointId = item.route.fromPointId ?? "";
      this.toPointId = item.route.toPointId ?? "";
    }
  }

  onOpen(): void {
    this.plugin.applyDirection(this.contentEl);
    const localizedKind = this.plugin.t(this.item.kind === "point" ? "item.point" : "item.route");
    this.contentEl.createEl("h2", { text: this.plugin.t("modal.editItem", { kind: localizedKind }) });
    textSetting(this.contentEl, this.plugin.t("field.title"), this.title, (value) => (this.title = value));
    textSetting(this.contentEl, this.plugin.t("field.start"), this.start, (value) => (this.start = value), "time");
    textSetting(this.contentEl, this.plugin.t("field.end"), this.end, (value) => (this.end = value), "time");
    textSetting(
      this.contentEl,
      this.plugin.t(this.item.kind === "point" ? "field.address" : "field.line"),
      this.detail,
      (value) => (this.detail = value),
    );
    if (this.item.kind === "point") {
      textSetting(this.contentEl, this.plugin.t("field.originalName"), this.originalName, (value) => (this.originalName = value), "text", this.plugin.t("desc.placeNames"));
      textSetting(this.contentEl, this.plugin.t("field.localizedName"), this.localizedName, (value) => (this.localizedName = value));
      textSetting(this.contentEl, this.plugin.t("field.localizedLanguage"), this.localizedLanguage, (value) => (this.localizedLanguage = value));
      dropdownSetting(
        this.contentEl,
        this.plugin.t("field.nameDisplay"),
        nameDisplayPreferences,
        this.nameDisplayPreference,
        (value) => (this.nameDisplayPreference = value as PlaceNameDisplayPreference),
        (value) => this.plugin.t(`nameDisplay.${value}` as TranslationKey),
      );
      textSetting(
        this.contentEl,
        this.plugin.t("field.latitude"),
        this.latitude,
        (value) => (this.latitude = value),
        "number",
      );
      textSetting(
        this.contentEl,
        this.plugin.t("field.longitude"),
        this.longitude,
        (value) => (this.longitude = value),
        "number",
      );
      textSetting(
        this.contentEl,
        this.plugin.t("field.opens"),
        this.opens,
        (value) => (this.opens = value),
        "time",
        this.plugin.t("desc.openingHours"),
      );
      textSetting(this.contentEl, this.plugin.t("field.closes"), this.closes, (value) => (this.closes = value), "time");
      textSetting(
        this.contentEl,
        this.plugin.t("field.plannedCostAmount"),
        this.plannedCost,
        (value) => (this.plannedCost = value),
        "number",
      );
      textSetting(
        this.contentEl,
        this.plugin.t("field.plannedCostCurrency"),
        this.plannedCurrency,
        (value) => (this.plannedCurrency = value),
      );
    } else {
      dropdownSetting(
        this.contentEl,
        this.plugin.t("field.mode"),
        transportModes,
        this.mode,
        (value) => (this.mode = value as TransportMode),
        (value) => this.plugin.t(`transport.${value}` as TranslationKey),
      );
      textSetting(this.contentEl, this.plugin.t("field.operator"), this.operator, (value) => (this.operator = value));
      textSetting(
        this.contentEl,
        this.plugin.t("field.delay"),
        this.delayMinutes,
        (value) => (this.delayMinutes = value),
        "number",
      );
      textSetting(
        this.contentEl,
        this.plugin.t("field.fareAmount"),
        this.fareAmount,
        (value) => (this.fareAmount = value),
        "number",
      );
      textSetting(
        this.contentEl,
        this.plugin.t("field.fareCurrency"),
        this.fareCurrency,
        (value) => (this.fareCurrency = value),
      );
      const points = this.plugin.store.dataset.timelineItems.filter(
        (item) => item.dayId === this.item.dayId && item.kind === "point",
      );
      relationDropdownSetting(
        this.contentEl,
        this.plugin.t("field.fromPoint"),
        points,
        (value) => (this.fromPointId = value),
        this.fromPointId,
        this.plugin.t("relation.notLinked"),
      );
      relationDropdownSetting(
        this.contentEl,
        this.plugin.t("field.toPoint"),
        points,
        (value) => (this.toPointId = value),
        this.toPointId,
        this.plugin.t("relation.notLinked"),
      );
    }
    textSetting(
      this.contentEl,
      this.plugin.t("field.checklist"),
      this.checklist,
      (value) => (this.checklist = value),
      "text",
      this.plugin.t("desc.checklistEdit"),
    );
    textAreaSetting(this.contentEl, this.plugin.t("field.notes"), this.notes, (value) => (this.notes = value));
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(this.plugin.t("button.save"))
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    const dataset = this.plugin.store.dataset;
    const day = dataset.days.find((candidate) => candidate.id === this.item.dayId);
    if (!day || !this.title.trim()) return;
    if (!validOpeningHours(this.opens, this.closes)) {
      new Notice(this.plugin.t("notice.invalidOpeningHours"));
      return;
    }
    const before = clone(this.item);
    ensureBaseline(this.item);
    this.item.title = this.title.trim();
    this.item.schedule.current.start = zonedLocalToIso(day.date, this.start, day.timeZone);
    this.item.schedule.current.end = zonedLocalToIso(day.date, this.end, day.timeZone);
    this.item.notes = this.notes.trim();
    this.item.updatedAt = nowIso();
    if (this.item.kind === "point") {
      this.item.place.customName = this.title.trim();
      this.item.place.name = this.originalName.trim() || this.localizedName.trim() || this.item.place.name || this.title.trim();
      if (this.originalName.trim()) this.item.place.originalName = { text: this.originalName.trim() };
      else delete this.item.place.originalName;
      const otherLocalizedNames = (this.item.place.localizedNames ?? []).filter(
        (name) => name.languageCode !== this.localizedLanguage.trim() || name.provider !== "google-places",
      );
      if (this.localizedName.trim() && this.localizedLanguage.trim()) {
        this.item.place.localizedNames = [
          ...otherLocalizedNames,
          { text: this.localizedName.trim(), languageCode: this.localizedLanguage.trim(), provider: "google-places" },
        ];
      } else if (otherLocalizedNames.length) this.item.place.localizedNames = otherLocalizedNames;
      else delete this.item.place.localizedNames;
      this.item.place.nameDisplayPreference = this.nameDisplayPreference;
      this.item.title = placeDisplayName(
        this.item.place,
        resolveLanguage(this.plugin.settings.language, globalThis.navigator?.language ?? "en"),
      );
      this.item.place.address = this.detail.trim();
      const latitude = optionalNumber(this.latitude);
      const longitude = optionalNumber(this.longitude);
      if (validCoordinates(latitude, longitude)) this.item.place.coordinates = { latitude, longitude };
      else delete this.item.place.coordinates;
      const openingPeriod = createOpeningPeriod(day.date, this.opens, this.closes);
      const openingPeriods = updateOpeningPeriods(this.item.place.openingPeriods, day.date, openingPeriod);
      if (openingPeriod) {
        this.item.place.openingHoursText = `${openingPeriod.opens}-${openingPeriod.closes}`;
      } else {
        delete this.item.place.openingHoursText;
      }
      if (openingPeriods.length) this.item.place.openingPeriods = openingPeriods;
      else delete this.item.place.openingPeriods;
      syncPointPlannedExpense(dataset, this.item, this.plannedCost, this.plannedCurrency);
    } else {
      this.item.route.lineName = this.detail.trim();
      this.item.route.mode = this.mode;
      this.item.route.operator = this.operator.trim();
      const delayMinutes = optionalNumber(this.delayMinutes);
      if (Number.isFinite(delayMinutes)) this.item.route.delayMinutes = delayMinutes;
      else delete this.item.route.delayMinutes;
      const fareAmount = optionalNumber(this.fareAmount);
      if (Number.isFinite(fareAmount) && fareAmount > 0) {
        this.item.route.fare = { amount: fareAmount, currency: this.fareCurrency.trim().toUpperCase() || "USD" };
      } else {
        delete this.item.route.fare;
      }
      if (this.fromPointId) this.item.route.fromPointId = this.fromPointId;
      else delete this.item.route.fromPointId;
      if (this.toPointId) this.item.route.toPointId = this.toPointId;
      else delete this.item.route.toPointId;
      syncRouteFareExpense(dataset, this.item);
    }
    syncItemChecklist(dataset, this.item, splitList(this.checklist));
    dataset.planChanges.push({
      id: newId("change"),
      tripId: this.item.tripId,
      entityType: "timelineItem",
      entityId: this.item.id,
      changedAt: nowIso(),
      source: "user",
      reason: "Edited in Obsidian",
      before: before as unknown as Record<string, unknown>,
      after: clone(this.item) as unknown as Record<string, unknown>,
    });
    await this.plugin.store.save();
    await this.plugin.refreshViews();
    this.close();
  }
}

class TravelogUpsellModal extends Modal {
  constructor(
    app: App,
    private plugin: TravelogPlannerPlugin,
    private feature: "map" | "transit",
    private context: UpsellContext,
  ) {
    super(app);
  }

  onOpen(): void {
    this.plugin.applyDirection(this.contentEl);
    this.contentEl.addClass("travelog-upsell");
    this.contentEl.createEl("h2", { text: this.plugin.t(`upsell.${this.feature}.title`) });
    this.contentEl.createEl("p", { text: this.plugin.t(`upsell.${this.feature}.body`) });

    const route = this.context.route;
    if (this.feature === "transit" && route?.kind === "route") {
      const dataset = this.plugin.store.dataset;
      const from = dataset.timelineItems.find((item) => item.id === route.route.fromPointId);
      const to = dataset.timelineItems.find((item) => item.id === route.route.toPointId);
      this.contentEl.createEl("p", {
        cls: "travelog-planner__muted",
        text: this.plugin.t("upsell.context", {
          from: from?.title ?? this.plugin.t("relation.notLinked"),
          to: to?.title ?? this.plugin.t("relation.notLinked"),
        }),
      });
    }

    const url = this.plugin.settings.travelogWebAppUrl.trim();
    if (!validWebUrl(url)) {
      this.contentEl.createEl("p", { cls: "travelog-planner__muted", text: this.plugin.t("upsell.notConfigured") });
      return;
    }

    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(this.plugin.t("button.openTravelog"))
        .setCta()
        .onClick(() => {
          window.open(buildTravelogUrl(url, this.feature, this.context), "_blank");
          this.close();
        }),
    );
  }
}

class TravelogSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: TravelogPlannerPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.plugin.applyDirection(this.containerEl);
    new Setting(this.containerEl)
      .setName(this.plugin.t("setting.language.name"))
      .setDesc(this.plugin.t("setting.language.desc"))
      .addDropdown((dropdown) => {
        for (const language of LANGUAGE_OPTIONS) {
          dropdown.addOption(language.value, language.label);
        }
        dropdown.setValue(this.plugin.settings.language).onChange(async (value) => {
          this.plugin.settings.language = value as LanguageSetting;
          await this.plugin.saveSettings();
          this.display();
        });
      });
    new Setting(this.containerEl)
      .setName(this.plugin.t("setting.dataPath.name"))
      .setDesc(this.plugin.t("setting.dataPath.desc"))
      .addText((text) =>
        text.setValue(this.plugin.settings.dataPath).onChange(async (value) => {
          this.plugin.settings.dataPath = value.trim() || DEFAULT_SETTINGS.dataPath;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(this.containerEl)
      .setName(this.plugin.t("setting.webUrl.name"))
      .setDesc(this.plugin.t("setting.webUrl.desc"))
      .addText((text) =>
        text.setPlaceholder("https://travelog.example").setValue(this.plugin.settings.travelogWebAppUrl).onChange(async (value) => {
          this.plugin.settings.travelogWebAppUrl = value.trim();
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
  }
}

function textSetting(
  parent: HTMLElement,
  name: string,
  value: string,
  onChange: (value: string) => void,
  type: string = "text",
  description?: string,
): void {
  const setting = new Setting(parent).setName(name);
  if (description) setting.setDesc(description);
  setting.addText((text) => {
    text.setValue(value).onChange(onChange);
    text.inputEl.type = type;
  });
}

function textAreaSetting(parent: HTMLElement, name: string, value: string, onChange: (value: string) => void): void {
  new Setting(parent).setName(name).addTextArea((text) => text.setValue(value).onChange(onChange));
}

function dropdownSetting(
  parent: HTMLElement,
  name: string,
  options: readonly string[],
  value: string,
  onChange: (value: string) => void,
  labelForValue: (value: string) => string = (option) => option,
): void {
  new Setting(parent).setName(name).addDropdown((dropdown) => {
    for (const option of options) dropdown.addOption(option, labelForValue(option));
    dropdown.setValue(value).onChange(onChange);
  });
}

function relationDropdownSetting(
  parent: HTMLElement,
  name: string,
  points: TimelineItem[],
  onChange: (value: string) => void,
  value = "",
  emptyLabel = "Not linked",
): void {
  new Setting(parent).setName(name).addDropdown((dropdown) => {
    dropdown.addOption("", emptyLabel);
    for (const point of points) dropdown.addOption(point.id, point.title);
    dropdown.setValue(value).onChange(onChange);
  });
}

function createDays(trip: Trip): TravelDay[] {
  const dataset = createEmptyDataset();
  dataset.trips.push(trip);
  syncTripDateRange(dataset, trip.id, trip.startDate, trip.endDate, trip.timeZone);
  return dataset.days;
}

function nextSortOrder(dataset: TravelogDataset, dayId: string): number {
  const orders = dataset.timelineItems.filter((item) => item.dayId === dayId).map((item) => item.sortOrder);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

function formatWindow(window: { start: string | null; end: string | null }, unscheduled: string): string {
  if (!window.start && !window.end) return unscheduled;
  const timeZone = "timeZone" in window && typeof window.timeZone === "string" ? window.timeZone : "UTC";
  return `${timeInZone(window.start, timeZone) || "?"} - ${timeInZone(window.end, timeZone) || "?"}`;
}

function localizedWarning(
  plugin: TravelogPlannerPlugin,
  dataset: TravelogDataset,
  warning: ScheduleWarning,
): string {
  const keys: Record<ScheduleWarning["code"], TranslationKey> = {
    "invalid-window": "warning.invalidWindow",
    overlap: "warning.overlap",
    "outside-opening-hours": "warning.outsideOpeningHours",
    "broken-route-link": "warning.brokenRouteLink",
  };
  const title = dataset.timelineItems.find((item) => item.id === warning.itemId)?.title ?? warning.itemId;
  return plugin.t(keys[warning.code], { title });
}

function timeInput(value: string | null, timeZone = "UTC"): string {
  return timeInZone(value, timeZone);
}

function validCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function optionalNumber(value: string): number {
  return value.trim() ? Number(value) : Number.NaN;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function validDateRange(start: string, end: string): boolean {
  return validIsoDate(start) && validIsoDate(end) && start <= end;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function validWebUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function buildTravelogUrl(base: string, feature: "map" | "transit", context: UpsellContext): string {
  const url = new URL(base);
  url.searchParams.set("source", "obsidian");
  url.searchParams.set("feature", feature);
  if (context.tripId) url.searchParams.set("tripId", context.tripId);
  if (context.dayId) url.searchParams.set("dayId", context.dayId);
  if (context.route?.kind === "route") {
    url.searchParams.set("routeId", context.route.id);
    if (context.route.route.fromPointId) url.searchParams.set("fromPointId", context.route.route.fromPointId);
    if (context.route.route.toPointId) url.searchParams.set("toPointId", context.route.route.toPointId);
  }
  return url.toString();
}

function validOpeningHours(opens: string, closes: string): boolean {
  return (!opens && !closes) || (validTimeValue(opens) && validTimeValue(closes));
}

function validTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function createOpeningPeriod(
  date: string,
  opens: string,
  closes: string,
): { dayOfWeek: number; opens: string; closes: string } | undefined {
  if (!validTimeValue(opens) || !validTimeValue(closes)) return undefined;
  return {
    dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
    opens,
    closes,
  };
}

function parseOpeningHoursText(value: string | undefined): { opens: string; closes: string } | undefined {
  const match = value?.match(/\b([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\b/);
  if (!match) return undefined;
  return { opens: `${match[1]}:${match[2]}`, closes: `${match[3]}:${match[4]}` };
}

function openingPeriodForDate(
  periods: readonly OpeningPeriod[] | undefined,
  date: string | undefined,
): OpeningPeriod | undefined {
  if (!date) return undefined;
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
  return periods?.find((period) => period.dayOfWeek === dayOfWeek);
}

function updateOpeningPeriods(
  periods: readonly OpeningPeriod[] | undefined,
  date: string,
  replacement: OpeningPeriod | undefined,
): OpeningPeriod[] {
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
  const remaining = (periods ?? []).filter((period) => period.dayOfWeek !== dayOfWeek);
  return replacement ? [...remaining, replacement] : remaining;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const transportModes = [
  "walk",
  "bicycle",
  "car",
  "taxi",
  "bus",
  "tram",
  "subway",
  "train",
  "ferry",
  "flight",
  "other",
] as const;

const nameDisplayPreferences: PlaceNameDisplayPreference[] = ["original", "localized", "custom"];

const tripStatuses: Trip["status"][] = ["idea", "planning", "ready", "traveling", "completed", "archived"];

function syncRouteFareExpense(dataset: TravelogDataset, item: TimelineItem): void {
  if (item.kind !== "route") return;
  const existing = dataset.expenses.find(
    (expense) => expense.timelineItemId === item.id && expense.phase === "planned" && expense.category === "transport",
  );
  if (!item.route.fare) {
    if (existing) dataset.expenses = dataset.expenses.filter((expense) => expense.id !== existing.id);
    return;
  }
  if (existing) {
    existing.amount = item.route.fare.amount;
    existing.currency = item.route.fare.currency;
  } else {
    dataset.expenses.push({
      id: newId("expense"),
      tripId: item.tripId,
      dayId: item.dayId,
      timelineItemId: item.id,
      phase: "planned",
      category: "transport",
      amount: item.route.fare.amount,
      currency: item.route.fare.currency,
    });
  }
}

function syncPointPlannedExpense(
  dataset: TravelogDataset,
  item: TimelineItem,
  amountValue: string,
  currencyValue: string,
): void {
  if (item.kind !== "point") return;
  const existing = dataset.expenses.find(
    (expense) =>
      expense.timelineItemId === item.id &&
      expense.phase === "planned" &&
      expense.category === "activity",
  );
  const amount = optionalNumber(amountValue);
  if (!Number.isFinite(amount) || amount <= 0) {
    if (existing) dataset.expenses = dataset.expenses.filter((expense) => expense.id !== existing.id);
    return;
  }
  const trip = dataset.trips.find((candidate) => candidate.id === item.tripId);
  const currency = currencyValue.trim().toUpperCase() || trip?.baseCurrency || "USD";
  if (existing) {
    existing.amount = amount;
    existing.currency = currency;
  } else {
    dataset.expenses.push({
      id: newId("expense"),
      tripId: item.tripId,
      dayId: item.dayId,
      timelineItemId: item.id,
      phase: "planned",
      category: "activity",
      amount,
      currency,
    });
  }
}

function syncItemChecklist(dataset: TravelogDataset, item: TimelineItem, labels: string[]): void {
  const remaining = dataset.checklistItems.filter((candidate) => candidate.timelineItemId === item.id);
  const synced = labels.map((label, sortOrder) => {
    const existingIndex = remaining.findIndex((candidate) => candidate.label === label);
    const existing = existingIndex >= 0 ? remaining.splice(existingIndex, 1)[0] : undefined;
    return existing
      ? { ...existing, label, sortOrder }
      : {
          id: newId("check"),
          tripId: item.tripId,
          dayId: item.dayId,
          timelineItemId: item.id,
          label,
          phase: "during" as const,
          completed: false,
          sortOrder,
        };
  });
  dataset.checklistItems = dataset.checklistItems.filter((candidate) => candidate.timelineItemId !== item.id);
  dataset.checklistItems.push(...synced);
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) await app.vault.adapter.mkdir(current);
  }
}
