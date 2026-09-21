import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
export function fingerprint(root) {
  const files = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const h = createHash("sha256");
  for (const f of files.sort())
    h.update(f + "\0")
      .update(fs.readFileSync(path.join(root, f)))
      .update("\0");
  return h.digest("hex");
}
const [mode, wikiPath, appPath = "."] = process.argv.slice(2);
if (mode) {
  const root = path.resolve(appPath),
    wiki = path.resolve(wikiPath),
    hash = fingerprint(root),
    file = path.join(wiki, "contract.json");
  if (mode === "record") {
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          sourceFingerprint: hash,
          sourceRepository: "ramideltoro/pricedip",
          reviewedGuides: JSON.parse(
            fs.readFileSync(path.join(root, "config/documentation.json")),
          ).guides,
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Documentation contract recorded");
  } else {
    const contract = JSON.parse(fs.readFileSync(file));
    if (contract.sourceFingerprint !== hash)
      throw Error(
        "Documentation does not match this source tree. Update the guides and record the reviewed contract.",
      );
    for (const guide of contract.reviewedGuides)
      if (!fs.existsSync(path.join(wiki, "src/content/docs", guide + ".md")))
        throw Error("Missing guide " + guide);
    if (mode === "check") {
      console.log("Documentation matches source tree");
    } else if (mode === "release") {
      const sha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      const api = fs.readFileSync(path.join(root, "server/app.ts"), "utf8");
      const routes = [
        ...api.matchAll(
          /app\s*\.\s*(get|post|put|patch)\s*\(\s*["']([^"']+)["']/g,
        ),
      ].map(
        (m) =>
          "| " +
          m[1].toUpperCase() +
          " | `" +
          m[2] +
          "` | " +
          (m[2].startsWith("/api/owner")
            ? "Owner session + same-origin writes"
            : m[2].startsWith("/internal")
              ? "Private bearer token"
              : "Public / authentication flow") +
          " |",
      );
      fs.writeFileSync(
        path.join(wiki, "src/content/docs/reference/api.md"),
        "---\ntitle: API reference\n---\n\nGenerated from application commit `" +
          sha +
          "`.\n\n| Method | Route | Access |\n|---|---|---|\n" +
          routes.join("\n") +
          "\n",
      );
      const config = fs
        .readFileSync(path.join(root, ".env.example"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map(
          (l) =>
            "| `" +
            l.split("=")[0] +
            "` | " +
            (l.slice(l.indexOf("=") + 1) ||
              "Secret / optional; configure privately") +
            " |",
        );
      fs.writeFileSync(
        path.join(wiki, "src/content/docs/reference/configuration.md"),
        "---\ntitle: Configuration reference\n---\n\n| Variable | Default or requirement |\n|---|---|\n" +
          config.join("\n") +
          "\n",
      );
      const history = execFileSync("git", ["log", "--format=%h %s"], {
        cwd: root,
        encoding: "utf8",
      });
      const snapshots = [
        ...new Set([
          ...contract.reviewedGuides,
          "reference/api",
          "reference/configuration",
        ]),
      ]
        .map((guide) => {
          const markdown = fs.readFileSync(
            path.join(wiki, "src/content/docs", guide + ".md"),
            "utf8",
          );
          const title = markdown.match(/^title: (.+)$/m)?.[1] || guide;
          return (
            "\n## " +
            title +
            "\n\n" +
            markdown
              .replace(/^---\n[\s\S]*?\n---\n/, "")
              .replace(/^(#{1,5}) /gm, "$1## ")
          );
        })
        .join("\n");
      fs.writeFileSync(
        path.join(wiki, "src/content/docs/releases", sha + ".md"),
        '---\ntitle: "Release ' +
          sha.slice(0, 12) +
          '"\n---\n\nSource: [' +
          sha +
          "](https://github.com/ramideltoro/pricedip/commit/" +
          sha +
          ")\n\nDocumentation fingerprint: `" +
          hash +
          "`\n\n```text\n" +
          history +
          "```\n\nThe following guides are preserved for this exact application release.\n" +
          snapshots,
      );
      fs.writeFileSync(
        path.join(wiki, "public/release.json"),
        JSON.stringify({ app: sha, fingerprint: hash }),
      );
      console.log("Generated release references for " + sha);
    }
  }
}
