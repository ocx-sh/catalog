/**
 * `ocx-catalog dev`, end to end (C-024, C-044, S-004, S-021): the shipped CLI
 * (`node dist/cli/index.js dev …`, an `astro dev` child inside) run as a
 * subprocess over a tmp copy of the `catalog` fixture, probed over real HTTP.
 *
 * One live session carries most of the suite, in order: boot, then a config
 * edit, a nested source-file edit, an added and a removed package, an invalid
 * edit, the confinement probes, a `base` change, and last SIGINT. Booting
 * `astro dev` costs seconds, so the cases share it on purpose; each case
 * states what it relies on from the one before and starts from a poll, never
 * from a fixed sleep. Port-in-use needs no session and runs on its own.
 *
 * Does not use the built fixture sites; `ACCEPT_CONFIG=root` keeps the setup
 * short.
 */
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_DIR, REPO_ROOT, leftoverScratch, runCli } from "./helpers.js";
import { count, freePort, get, startDev, until, type Reply, type Session } from "./dev_session.js";

const accepts = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

describe("ocx-catalog dev over the catalog fixture", () => {
  let root: string;
  let project: string;
  let config: string;
  let session: Session;
  let origin: string;

  const catalogJson = (base = "/catalog/"): Promise<Reply> => get(`${origin}${base}data/catalog/catalog.json`);
  /** Waits until `catalog.json` satisfies `accept`, and returns its bytes. */
  const catalogWhere = (what: string, accept: (bytes: string) => boolean, base?: string): Promise<string> =>
    until(what, session, async () => {
      const reply = await catalogJson(base);
      return reply.status === 200 && accept(reply.body) ? reply.body : undefined;
    });
  const reloads = (): number => count(session.stdout(), "ocx-catalog dev: reloaded (");

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "ocx-accept-dev-")));
    project = join(root, "proj");
    await mkdir(project, { recursive: true });
    for (const name of ["index-a", "index-b", "catalog.config.json"]) {
      await cp(join(FIXTURE_DIR, name), join(project, name), { recursive: true });
    }
    await writeFile(join(project, ".env"), "OCX_DEV_ACCEPT_SECRET=hunter2\n");
    config = join(project, "catalog.config.json");
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    session = startDev(config, port);
  }, 120_000);

  afterAll(async () => {
    if (session.child.exitCode === null) session.child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  });

  it("boots under /catalog/: the banner names the URL with the base, the site and catalog.json answer 200", async () => {
    await until("the banner", session, () => (session.stdout().includes("serving") ? true : undefined));

    expect(session.stdout()).toContain(`ocx-catalog dev: serving ${origin}/catalog/`);
    const landing = await get(`${origin}/catalog/`);
    expect(landing.status).toBe(200);
    expect(new JSDOM(landing.body).window.document.querySelectorAll("h1").length).toBeGreaterThan(0);
    const catalog = JSON.parse((await catalogJson()).body) as { indexes: { name: string; excludeFromAll: boolean }[] };
    expect(catalog.indexes.map((index) => index.name)).toEqual(["index-a", "index-b"]);
    expect((await get(`${origin}/catalog/tools/modern/`)).status).toBe(200);
    expect((await get(`${origin}/`)).status).toBe(404); // outside the base
  });

  it("binds 127.0.0.1 only: not the IPv6 loopback, not a LAN address", async () => {
    expect(await accepts("127.0.0.1", session.port)).toBe(true);
    expect(await accepts("::1", session.port)).toBe(false);
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((address) => address !== undefined && address.family === "IPv4" && !address.internal);
    for (const address of lan) expect(await accepts(address!.address, session.port)).toBe(false);
  });

  it("a config edit shows up in catalog.json without a restart", async () => {
    const before = await catalogWhere("the boot catalog", () => true);
    expect(JSON.parse(before).indexes[1].excludeFromAll).toBe(true);
    const pid = session.child.pid;
    const reloadsBefore = reloads();

    const edited = JSON.parse(await readFile(config, "utf8")) as { sources: Record<string, unknown>[] };
    edited.sources[1]!.excludeFromAll = false;
    await writeFile(config, JSON.stringify(edited));

    const after = await catalogWhere("the edited config", (bytes) => bytes !== before);
    expect(JSON.parse(after).indexes[1].excludeFromAll).toBe(false);
    await until("the reload notice", session, () => (reloads() > reloadsBefore ? true : undefined));
    expect(session.child.pid).toBe(pid);
    expect(session.child.exitCode).toBeNull();
  });

  it("a nested file in a path source reaches catalog.json and the package page", async () => {
    const root = join(project, "index-a", "p", "tools", "modern.json");
    const before = await catalogWhere("the current catalog", () => true);
    const edited = (await readFile(root, "utf8")).replace('"title": "modern"', '"title": "modern edited in place"');
    expect(edited).toContain("edited in place");

    await writeFile(root, edited);

    const after = await catalogWhere("the nested edit", (bytes) => bytes.includes("modern edited in place"));
    expect(after).not.toBe(before);
    await until("the package page", session, async () => {
      const page = await get(`${origin}/catalog/tools/modern/`);
      return page.status === 200 && page.body.includes("modern edited in place") ? true : undefined;
    });
  });

  it("an added package appears (catalog.json bytes, route, h1) and a removed one disappears again", async () => {
    const tools = join(project, "index-a", "p", "tools");
    expect((await get(`${origin}/catalog/tools/newtool/`)).status).toBe(404);
    const before = await catalogWhere("the current catalog", () => true);
    // A package is its root plus its content-addressed files; the copy is renamed to `newtool`.
    await cp(join(tools, "modern"), join(tools, "newtool"), { recursive: true });
    const addedRoot = (await readFile(join(tools, "modern.json"), "utf8"))
      .replace("index-a/tools/modern", "index-a/tools/newtool")
      .replace(/"title": "[^"]*"/, '"title": "newtool title"');
    await writeFile(join(tools, "newtool.json"), addedRoot);

    const added = await catalogWhere("the new package", (bytes) => bytes.includes("index-a/tools/newtool"));
    expect(added).not.toBe(before);
    const page = await until("the new route", session, async () => {
      const reply = await get(`${origin}/catalog/tools/newtool/`);
      return reply.status === 200 ? reply : undefined;
    });
    const h1s = [...new JSDOM(page.body).window.document.querySelectorAll("h1")].map((h1) => h1.textContent ?? "");
    expect(h1s.length).toBeGreaterThan(0);

    await rm(join(tools, "newtool.json"));
    await rm(join(tools, "newtool"), { recursive: true });

    const removed = await catalogWhere("the removal", (bytes) => !bytes.includes("index-a/tools/newtool"));
    expect(removed).toBe(before);
    await until("the route to go", session, async () =>
      (await get(`${origin}/catalog/tools/newtool/`)).status === 404 ? true : undefined,
    );
  });

  it("an invalid edit prints the error, keeps serving the last good state, and the next valid edit recovers", async () => {
    const good = await readFile(config, "utf8");
    const bytes = await catalogWhere("the current catalog", () => true);
    const failuresBefore = count(session.stderr(), "reload failed, keeping the last good state");

    await writeFile(config, "{ not json");

    await until("the reload failure", session, () =>
      count(session.stderr(), "reload failed, keeping the last good state") > failuresBefore ? true : undefined,
    );
    expect(session.stderr()).toContain("ocx-catalog dev: reload failed, keeping the last good state: ");
    expect((await catalogJson()).body).toBe(bytes);
    expect((await get(`${origin}/catalog/tools/modern/`)).status).toBe(200);
    expect(session.child.exitCode).toBeNull();

    const reloadsBefore = reloads();
    await writeFile(config, good);
    await until("the recovery", session, () => (reloads() > reloadsBefore ? true : undefined));
    expect((await catalogJson()).body).toBe(bytes);
  });

  it("confines the dev server: /@fs/<configDir>/.env is refused, while a file inside the package dir is served", async () => {
    // Positive control: the endpoint works, so the refusal below is the confinement and not a dead route.
    const allowed = await get(`${origin}/@fs${join(REPO_ROOT, "package.json")}`);
    expect(allowed.status).toBe(200);

    for (const prefix of ["", "/catalog"]) {
      const refused = await get(`${origin}${prefix}/@fs${join(project, ".env")}`);
      expect([403, 404]).toContain(refused.status);
      expect(refused.body).not.toContain("hunter2");
    }
  });

  it("a base change respawns the server on the same port under the new base", async () => {
    const pid = session.child.pid;
    const edited = JSON.parse(await readFile(config, "utf8")) as { base: string };
    edited.base = "/moved/";

    await writeFile(config, JSON.stringify(edited));

    await until("the second banner", session, () =>
      session.stdout().includes(`serving ${origin}/moved/`) ? true : undefined,
    );
    expect(session.stdout()).toContain("ocx-catalog dev: base is now /moved/, restarting the server");
    await catalogWhere("the new base", () => true, "/moved/");
    expect((await get(`${origin}/moved/`)).status).toBe(200);
    expect((await get(`${origin}/catalog/`)).status).toBe(404);
    expect(session.child.pid).toBe(pid); // the supervisor stays; only its Astro child was replaced
    expect(session.child.exitCode).toBeNull();
  });

  it("SIGINT stops it cleanly: exit 0, the port closed, no scratch root left behind", async () => {
    const pid = session.child.pid!;
    expect((await leftoverScratch(pid)).length).toBeGreaterThan(0); // control: the root existed while running

    session.child.kill("SIGINT");

    expect(await session.exited()).toBe(0);
    expect(await leftoverScratch(pid)).toEqual([]);
    expect(await accepts("127.0.0.1", session.port)).toBe(false);
  });
});

describe("ocx-catalog dev refuses a bound port", () => {
  it("exits 69 naming the port and starts no child", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "ocx-accept-dev-busy-")));
    const holder = createServer();
    try {
      await mkdir(join(root, "proj"), { recursive: true });
      await cp(join(FIXTURE_DIR, "index-a"), join(root, "proj", "index-a"), { recursive: true });
      const config = join(root, "proj", "catalog.config.json");
      await writeFile(config, JSON.stringify({ sources: [{ path: "./index-a", root: true }], brand: { title: "Busy" } }));
      await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
      const { port } = holder.address() as { port: number };

      const result = await runCli(["dev", "--config", config, "--port", String(port)]);

      expect(result.code).toBe(69);
      expect(result.stderr).toContain(`ocx-catalog dev: port ${port} is already in use`);
      expect(result.stdout).toBe("");
      expect(await leftoverScratch(result.pid)).toEqual([]);
    } finally {
      await new Promise((resolve) => holder.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  });
});
