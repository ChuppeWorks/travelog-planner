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
  scheduleWarnings,
  shiftItemAndFollowing,
  timeInZone,
  validateDataset,
  zonedLocalToIso,
  type TimelineItem,
  type TransportMode,
  type TravelDay,
  type TravelogDataset,
  type Trip,
} from "../../../packages/schema/src";
import { datasetToNotionTables, NOTION_TABLE_FILES } from "../../../packages/interchange/src";

const VIEW_TYPE = "travelog-planner-view";

interface TravelogSettings {
  dataPath: string;
}

const DEFAULT_SETTINGS: TravelogSettings = {
  dataPath: "Travelog/travelog.json",
};

export default class TravelogPlannerPlugin extends Plugin {
  settings: TravelogSettings = DEFAULT_SETTINGS;
  store!: TravelogStore;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.store = new TravelogStore(this.app, this.settings.dataPath);
    await this.store.load();

    this.registerView(VIEW_TYPE, (leaf) => new TravelogPlannerView(leaf, this));
    this.addRibbonIcon("map", "Open Travelog Planner", () => void this.activateView());
    this.addCommand({
      id: "open-planner",
      name: "Open planner",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "create-trip",
      name: "Create trip",
      callback: () => new CreateTripModal(this.app, this).open(),
    });
    this.addCommand({
      id: "export-notion-csv",
      name: "Export Notion CSV files",
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

  async exportNotionCsv(): Promise<void> {
    const parent = normalizePath(this.settings.dataPath).split("/").slice(0, -1).join("/");
    const directory = normalizePath(`${parent || "Travelog"}/notion-export`);
    await ensureFolder(this.app, directory);
    const tables = datasetToNotionTables(this.store.dataset);
    for (const [table, filename] of Object.entries(NOTION_TABLE_FILES)) {
      await this.app.vault.adapter.write(`${directory}/${filename}`, tables[table as keyof typeof tables]);
    }
    new Notice(`Exported Notion CSV files to ${directory}.`);
  }
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
    return "Travelog Planner";
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

    const dataset = this.plugin.store.dataset;
    this.normalizeSelection(dataset);

    const header = container.createDiv({ cls: "travelog-planner__header" });
    header.createEl("h2", { text: "Travelog Planner" });
    this.button(header, "New trip", () => new CreateTripModal(this.app, this.plugin).open());

    if (!dataset.trips.length) {
      container.createDiv({
        cls: "travelog-planner__empty",
        text: "Create a trip to start building a point-and-route timeline.",
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

    const toolbar = container.createDiv({ cls: "travelog-planner__toolbar" });
    this.button(toolbar, "Add point", () => this.openItemModal("point"));
    this.button(toolbar, "Add route", () => this.openItemModal("route"));
    this.button(toolbar, "Open day map", () => this.openDayMap());
    this.button(toolbar, "Freeze baseline", () => void this.freezeBaseline());
    this.button(toolbar, "Export Notion CSV", () => void this.plugin.exportNotionCsv());

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
      text: `${pointCount} point${pointCount === 1 ? "" : "s"} · ${routeCount} route${routeCount === 1 ? "" : "s"}${totals ? ` · Planned ${totals}` : ""}`,
    });

    const warnings = scheduleWarnings(dataset, this.selectedDayId!);
    if (warnings.length) {
      const warningBox = container.createDiv({ cls: "travelog-planner__warnings" });
      warningBox.createEl("strong", { text: `${warnings.length} schedule warning${warnings.length === 1 ? "" : "s"}` });
      const list = warningBox.createEl("ul");
      for (const warning of warnings) list.createEl("li", { text: warning.message });
    }

    const timeline = container.createDiv({ cls: "travelog-planner__timeline" });
    const items = dataset.timelineItems
      .filter((item) => item.dayId === this.selectedDayId)
      .sort(compareTimelineItems);
    if (!items.length) {
      timeline.createDiv({ cls: "travelog-planner__empty", text: "No points or routes on this day yet." });
      return;
    }
    for (const item of items) this.renderItem(timeline, item);
  }

  private renderItem(container: HTMLElement, item: TimelineItem): void {
    const card = container.createDiv({
      cls: `travelog-planner__item travelog-planner__item--${item.kind}`,
    });
    const header = card.createDiv({ cls: "travelog-planner__item-header" });
    header.createEl("strong", { text: item.title });
    header.createSpan({ cls: "travelog-planner__kind", text: item.kind === "point" ? "POINT" : "ROUTE" });

    card.createDiv({ text: formatWindow(item.schedule.current) });
    if (item.schedule.baseline) {
      card.createDiv({ cls: "travelog-planner__muted", text: `Baseline: ${formatWindow(item.schedule.baseline)}` });
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
        text: item.place.coordinates ? "Open coordinates in Google Maps" : "Search in Google Maps",
        href: item.place.coordinates
          ? `https://www.google.com/maps/search/?api=1&query=${item.place.coordinates.latitude},${item.place.coordinates.longitude}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.place.address ?? item.place.name)}`,
      });
      mapLink.setAttr("target", "_blank");
    } else {
      const detail = [item.route.mode, item.route.lineName, item.route.operator].filter(Boolean).join(" | ");
      card.createDiv({ cls: "travelog-planner__muted", text: detail });
      if (item.route.delayMinutes) {
        card.createDiv({ cls: "travelog-planner__muted", text: `Delay: ${item.route.delayMinutes} minutes` });
      }
      if (item.route.fare) {
        card.createDiv({
          cls: "travelog-planner__muted",
          text: `Fare: ${item.route.fare.amount} ${item.route.fare.currency}`,
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
        text: `Planned cost: ${expenses.map((expense) => `${expense.amount} ${expense.currency}`).join(" + ")}`,
      });
    }

    const actions = card.createDiv({ cls: "travelog-planner__item-actions" });
    this.button(actions, "-15m onward", () => void this.shift(item.id, -15));
    this.button(actions, "+15m onward", () => void this.shift(item.id, 15));
    if (item.kind === "route") this.button(actions, "Apply +15m delay", () => void this.delayRoute(item.id, 15));
    this.button(actions, "Edit", () => new EditItemModal(this.app, this.plugin, item).open());
    this.button(actions, "Delete", () => void this.deleteItem(item.id));
  }

  private openItemModal(kind: "point" | "route"): void {
    const day = this.plugin.store.dataset.days.find((candidate) => candidate.id === this.selectedDayId);
    const trip = this.plugin.store.dataset.trips.find((candidate) => candidate.id === this.selectedTripId);
    if (!day || !trip) return;
    new CreateItemModal(this.app, this.plugin, trip, day, kind).open();
  }

  private openDayMap(): void {
    const points = this.plugin.store.dataset.timelineItems
      .filter((item) => item.dayId === this.selectedDayId && item.kind === "point")
      .sort(compareTimelineItems)
      .map((item) =>
        item.kind === "point" && item.place.coordinates
          ? `${item.place.coordinates.latitude},${item.place.coordinates.longitude}`
          : item.kind === "point" ? item.place.address ?? item.place.name : "",
      )
      .filter(Boolean);
    if (!points.length) {
      new Notice("Add at least one point before opening the day map.");
      return;
    }
    const url =
      points.length === 1
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(points[0]!)}`
        : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(points[0]!)}&destination=${encodeURIComponent(points.at(-1)!)}&waypoints=${encodeURIComponent(points.slice(1, -1).join("|"))}`;
    window.open(url, "_blank");
  }

  private async freezeBaseline(): Promise<void> {
    const count = freezeTripBaseline(this.plugin.store.dataset, this.selectedTripId!);
    await this.plugin.store.save();
    new Notice(`Frozen baseline for ${count} timeline item${count === 1 ? "" : "s"}.`);
    await this.plugin.refreshViews();
  }

  private async shift(itemId: string, minutes: number): Promise<void> {
    const count = shiftItemAndFollowing(this.plugin.store.dataset, itemId, minutes);
    await this.plugin.store.save();
    new Notice(`Shifted ${count} item${count === 1 ? "" : "s"} by ${minutes} minutes.`);
    await this.plugin.refreshViews();
  }

  private async delayRoute(itemId: string, minutes: number): Promise<void> {
    const count = applyRouteDelay(this.plugin.store.dataset, itemId, minutes);
    await this.plugin.store.save();
    new Notice(`Applied ${minutes}-minute delay and shifted ${count} item${count === 1 ? "" : "s"}.`);
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
    this.contentEl.createEl("h2", { text: "Create trip" });
    textSetting(this.contentEl, "Name", "", (value) => (this.name = value));
    textSetting(this.contentEl, "Start date", this.startDate, (value) => (this.startDate = value), "date");
    textSetting(this.contentEl, "End date", this.endDate, (value) => (this.endDate = value), "date");
    textSetting(this.contentEl, "Timezone", this.timeZone, (value) => (this.timeZone = value));
    textSetting(this.contentEl, "Base currency", this.baseCurrency, (value) => (this.baseCurrency = value.toUpperCase()));
    textSetting(this.contentEl, "Destinations", "", (value) => (this.destinations = value), "text", "Comma-separated");
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Create")
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    if (!this.name.trim() || !validDateRange(this.startDate, this.endDate) || !validTimeZone(this.timeZone)) {
      new Notice("Enter a trip name, valid date range, and valid IANA timezone.");
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

class CreateItemModal extends Modal {
  private title = "";
  private start = "";
  private end = "";
  private notes = "";
  private address = "";
  private latitude = "";
  private longitude = "";
  private openingHours = "";
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
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: `Add ${this.kind}` });
    textSetting(this.contentEl, "Title", "", (value) => (this.title = value));
    textSetting(this.contentEl, "Start", "", (value) => (this.start = value), "time");
    textSetting(this.contentEl, "End", "", (value) => (this.end = value), "time");
    if (this.kind === "point") {
      textSetting(this.contentEl, "Address", "", (value) => (this.address = value));
      textSetting(this.contentEl, "Latitude", "", (value) => (this.latitude = value), "number");
      textSetting(this.contentEl, "Longitude", "", (value) => (this.longitude = value), "number");
      textSetting(
        this.contentEl,
        "Opening hours",
        "",
        (value) => (this.openingHours = value),
        "text",
        "Human-readable note, e.g. 09:00-18:00",
      );
    } else {
      dropdownSetting(this.contentEl, "Mode", transportModes, this.mode, (value) => (this.mode = value as TransportMode));
      textSetting(this.contentEl, "Line / service", "", (value) => (this.lineName = value));
      textSetting(this.contentEl, "Operator", "", (value) => (this.operator = value));
      textSetting(this.contentEl, "Known delay (minutes)", "", (value) => (this.delayMinutes = value), "number");
      const points = this.plugin.store.dataset.timelineItems.filter(
        (item) => item.dayId === this.day.id && item.kind === "point",
      );
      relationDropdownSetting(this.contentEl, "From point", points, (value) => (this.fromPointId = value));
      relationDropdownSetting(this.contentEl, "To point", points, (value) => (this.toPointId = value));
    }
    textSetting(
      this.contentEl,
      `${this.kind === "route" ? "Fare" : "Planned cost"} (${this.trip.baseCurrency})`,
      "",
      (value) => (this.plannedCost = value),
      "number",
    );
    textSetting(this.contentEl, "Checklist", "", (value) => (this.checklist = value), "text", "Comma-separated");
    textAreaSetting(this.contentEl, "Notes", "", (value) => (this.notes = value));
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Add")
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    if (!this.title.trim()) {
      new Notice("Enter a title.");
      return;
    }
    const dataset = this.plugin.store.dataset;
    const timestamp = nowIso();
    const itemId = newId(this.kind);
    const amount = optionalNumber(this.plannedCost);
    const latitude = optionalNumber(this.latitude);
    const longitude = optionalNumber(this.longitude);
    const delayMinutes = optionalNumber(this.delayMinutes);
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
              name: this.title.trim(),
              ...(this.address.trim() ? { address: this.address.trim() } : {}),
              ...(validCoordinates(latitude, longitude) ? { coordinates: { latitude, longitude } } : {}),
              ...(this.openingHours.trim() ? { openingHoursText: this.openingHours.trim() } : {}),
              ...(parseOpeningPeriod(this.day.date, this.openingHours)
                ? { openingPeriods: [parseOpeningPeriod(this.day.date, this.openingHours)!] }
                : {}),
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
  private start: string;
  private end: string;
  private notes: string;
  private detail: string;
  private latitude = "";
  private longitude = "";
  private openingHours = "";
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
      this.latitude = item.place.coordinates ? String(item.place.coordinates.latitude) : "";
      this.longitude = item.place.coordinates ? String(item.place.coordinates.longitude) : "";
      this.openingHours = item.place.openingHoursText ?? "";
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
    this.contentEl.createEl("h2", { text: `Edit ${this.item.kind}` });
    textSetting(this.contentEl, "Title", this.title, (value) => (this.title = value));
    textSetting(this.contentEl, "Start", this.start, (value) => (this.start = value), "time");
    textSetting(this.contentEl, "End", this.end, (value) => (this.end = value), "time");
    textSetting(
      this.contentEl,
      this.item.kind === "point" ? "Address" : "Line / service",
      this.detail,
      (value) => (this.detail = value),
    );
    if (this.item.kind === "point") {
      textSetting(this.contentEl, "Latitude", this.latitude, (value) => (this.latitude = value), "number");
      textSetting(this.contentEl, "Longitude", this.longitude, (value) => (this.longitude = value), "number");
      textSetting(this.contentEl, "Opening hours", this.openingHours, (value) => (this.openingHours = value));
      textSetting(this.contentEl, "Planned cost amount", this.plannedCost, (value) => (this.plannedCost = value), "number");
      textSetting(this.contentEl, "Planned cost currency", this.plannedCurrency, (value) => (this.plannedCurrency = value));
    } else {
      dropdownSetting(this.contentEl, "Mode", transportModes, this.mode, (value) => (this.mode = value as TransportMode));
      textSetting(this.contentEl, "Operator", this.operator, (value) => (this.operator = value));
      textSetting(this.contentEl, "Delay (minutes)", this.delayMinutes, (value) => (this.delayMinutes = value), "number");
      textSetting(this.contentEl, "Fare amount", this.fareAmount, (value) => (this.fareAmount = value), "number");
      textSetting(this.contentEl, "Fare currency", this.fareCurrency, (value) => (this.fareCurrency = value));
      const points = this.plugin.store.dataset.timelineItems.filter(
        (item) => item.dayId === this.item.dayId && item.kind === "point",
      );
      relationDropdownSetting(this.contentEl, "From point", points, (value) => (this.fromPointId = value), this.fromPointId);
      relationDropdownSetting(this.contentEl, "To point", points, (value) => (this.toPointId = value), this.toPointId);
    }
    textSetting(
      this.contentEl,
      "Checklist",
      this.checklist,
      (value) => (this.checklist = value),
      "text",
      "Comma-separated; matching items keep their completion state",
    );
    textAreaSetting(this.contentEl, "Notes", this.notes, (value) => (this.notes = value));
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("Save")
        .setCta()
        .onClick(() => void this.submit()),
    );
  }

  private async submit(): Promise<void> {
    const dataset = this.plugin.store.dataset;
    const day = dataset.days.find((candidate) => candidate.id === this.item.dayId);
    if (!day || !this.title.trim()) return;
    const before = clone(this.item);
    ensureBaseline(this.item);
    this.item.title = this.title.trim();
    this.item.schedule.current.start = zonedLocalToIso(day.date, this.start, day.timeZone);
    this.item.schedule.current.end = zonedLocalToIso(day.date, this.end, day.timeZone);
    this.item.notes = this.notes.trim();
    this.item.updatedAt = nowIso();
    if (this.item.kind === "point") {
      this.item.place.customName = this.title.trim();
      this.item.place.address = this.detail.trim();
      const latitude = optionalNumber(this.latitude);
      const longitude = optionalNumber(this.longitude);
      if (validCoordinates(latitude, longitude)) this.item.place.coordinates = { latitude, longitude };
      else delete this.item.place.coordinates;
      this.item.place.openingHoursText = this.openingHours.trim();
      const openingPeriod = parseOpeningPeriod(day.date, this.openingHours);
      if (openingPeriod) this.item.place.openingPeriods = [openingPeriod];
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

class TravelogSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: TravelogPlannerPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Travelog data path")
      .setDesc("Vault-relative path for the common Travelog JSON dataset.")
      .addText((text) =>
        text.setValue(this.plugin.settings.dataPath).onChange(async (value) => {
          this.plugin.settings.dataPath = value.trim() || DEFAULT_SETTINGS.dataPath;
          await this.plugin.saveSettings();
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
): void {
  new Setting(parent).setName(name).addDropdown((dropdown) => {
    for (const option of options) dropdown.addOption(option, option);
    dropdown.setValue(value).onChange(onChange);
  });
}

function relationDropdownSetting(
  parent: HTMLElement,
  name: string,
  points: TimelineItem[],
  onChange: (value: string) => void,
  value = "",
): void {
  new Setting(parent).setName(name).addDropdown((dropdown) => {
    dropdown.addOption("", "Not linked");
    for (const point of points) dropdown.addOption(point.id, point.title);
    dropdown.setValue(value).onChange(onChange);
  });
}

function createDays(trip: Trip): TravelDay[] {
  const days: TravelDay[] = [];
  const cursor = new Date(`${trip.startDate}T00:00:00Z`);
  const end = new Date(`${trip.endDate}T00:00:00Z`);
  let sortOrder = 0;
  while (cursor <= end) {
    days.push({
      id: newId("day"),
      tripId: trip.id,
      date: cursor.toISOString().slice(0, 10),
      sortOrder,
      timeZone: trip.timeZone,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    sortOrder += 1;
  }
  return days;
}

function nextSortOrder(dataset: TravelogDataset, dayId: string): number {
  const orders = dataset.timelineItems.filter((item) => item.dayId === dayId).map((item) => item.sortOrder);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

function formatWindow(window: { start: string | null; end: string | null }): string {
  if (!window.start && !window.end) return "Unscheduled";
  const timeZone = "timeZone" in window && typeof window.timeZone === "string" ? window.timeZone : "UTC";
  return `${timeInZone(window.start, timeZone) || "?"} - ${timeInZone(window.end, timeZone) || "?"}`;
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

function parseOpeningPeriod(
  date: string,
  value: string,
): { dayOfWeek: number; opens: string; closes: string } | undefined {
  const match = value.match(/\b([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\b/);
  if (!match) return undefined;
  return {
    dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
    opens: `${match[1]}:${match[2]}`,
    closes: `${match[3]}:${match[4]}`,
  };
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
