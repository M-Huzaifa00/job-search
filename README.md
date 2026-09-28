# Medical Remote Job Aggregator

Finds **current, fully-remote, US-eligible healthcare administration jobs** (medical billing, medical coding, credentialing, revenue cycle and similar roles) across several job platforms. It merges duplicates and writes the results to **CSV or JSON**.

Indeed, and any listing that routes through Indeed, is excluded on purpose.

It can run as a **command-line tool** or as an **HTTP API**.

---

## What it does

1. Searches every enabled job site for each job title (20 built-in healthcare titles by default).
2. Opens the job-detail pages to read the full description.
3. Keeps only jobs that are:
   - **fully remote.** Hybrid, "onsite every Tuesday" and similar jobs are rejected.
   - **open to US applicants.** Canada, UK, LATAM, India and other non-US jobs are rejected.
   - **relevant.** A "Python coder" is not a medical coder.
   - **recent.** By default, posted in the last 24 hours.
   - **not routed through Indeed.**
4. Merges the same job posted on several sites into one row.
5. Sorts by newest first and writes a CSV or JSON file.
6. Saves every run in a local SQLite database so it can mark jobs as **new** or **reposted** on later runs.

## Job sources

| Source | Status | How |
|---|---|---|
| LinkedIn | ✅ working | public job-search pages |
| JobRight | ✅ working | the site's own logged-out search API (remote, US, posted-within filters) |
| CareerJet | ✅ working | official API |
| Dice | ✅ working | public search pages |
| RemoteOK | ✅ working | public JSON feed |
| Remotive | ✅ working | public API |
| Jobicy | ✅ working | public API |
| Canada Job Bank | ✅ working | RSS feed (US-eligible jobs only) |
| Jooble | 🔑 needs a free API key | official API. Set `JOOBLE_API_KEY` |
| SimplyHired | ⛔ off by default | owned by Indeed. Opt in with `ALLOW_INDEED_NETWORK_SOURCES=true` |
| ZipRecruiter, Glassdoor, Monster, CareerBuilder, Wellfound, Built In | 🚫 blocked | bot protection (Cloudflare / DataDome). Reachability check only |
| FlexJobs | 🚫 blocked | Akamai "Access Denied" (HTTP 403) on every page; paid-membership site. Reachability check only |
| Indeed | 🚫 excluded | excluded by design, and Cloudflare-protected (HTTP 403). Listed for its reachability check only; it never runs and `--sources indeed` is refused |

Run `npm run cli -- probe` to see which sources are reachable right now.

Blocked sources are never scraped. Solving or getting around CAPTCHAs and bot checks is out of scope. Each blocked source makes one request when probed, to report its current status.

---

## Requirements

- **Node.js 22.18 or newer** ([download](https://nodejs.org/)). Node runs the TypeScript source directly, so there is no build step.
- No database server is needed. SQLite is built into Node.

Check your version:

```bash
node --version
```

## Installation

```bash
git clone https://github.com/<your-username>/medical-remote-job-aggregator.git
cd medical-remote-job-aggregator
npm install
```

Configuration is optional. To change any setting, copy the example file and edit it:

```bash
# macOS / Linux
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env
```

---

## Usage: command line

### Quick start

```bash
npm run search -- --output jobs.csv
```

This searches all enabled sources for the 20 built-in titles and writes the matching jobs to `jobs.csv`. A full run takes a few minutes. A progress table and summary are printed when it finishes.

> The `--` after `npm run search` is required. It passes the options that follow to the scraper.

### Examples

```bash
# Only a few titles (much faster)
npm run search -- --titles "medical billing,medical coder,credentialing specialist" --output jobs.csv

# Jobs from the last 3 days instead of 24 hours
npm run search -- --hours-old 72 --output jobs.csv

# Only specific sources
npm run search -- --sources linkedin,careerjet --output jobs.csv

# JSON output with the full run report
npm run search -- --format json --output jobs.json

# Fast mode: skip job-detail pages (less accurate filtering)
npm run search -- --no-details --output jobs.csv

# Read titles from a file (one per line, # for comments)
npm run search -- --titles-file my-titles.txt --output jobs.csv
```

Without `--output`, the CSV is printed to the terminal.

### All search options

| Option | Description | Default |
|---|---|---|
| `--titles <list>` | Comma-separated job titles | 20 built-in titles |
| `--titles-file <path>` | File with one title per line | – |
| `--sources <list>` | Comma-separated source ids | all enabled sources |
| `--hours-old <n>` | Maximum posting age in hours | `24` |
| `--format <csv\|json>` | Output format | `csv` |
| `--output <file>` | Write to a file instead of the terminal | terminal |
| `--max-pages <n>` | Result pages per title per source | `3` |
| `--max-results-per-source <n>` | Cap per source | `600` |
| `--max-results-per-keyword <n>` | Cap per title | `100` |
| `--no-remote-only` | Also return hybrid/onsite jobs | remote only |
| `--include-undated` | Keep jobs with no posting date | from `.env` |
| `--include-duplicates` | Also output merged duplicates (flagged) | off |
| `--include-rejected` | JSON only: include rejected jobs with the reason | off |
| `--no-details` | Skip job-detail pages | details on |
| `--no-persist` | Don't save to the SQLite database | saves |
| `--log-level <level>` | `debug`, `info`, `warn`, `error` | `info` |

Source ids: `linkedin`, `jobright`, `dice`, `remoteok`, `remotive`, `jobicy`, `careerjet`, `jooble`, `canada_job_bank`, `simplyhired`.

Probe-only ids (for `npm run cli -- probe <id>`): `ziprecruiter`, `glassdoor`, `careerbuilder`, `monster`, `wellfound`, `builtin`, `flexjobs`, `indeed`.

### Other commands

```bash
npm run cli -- sources        # list sources, status and last-run results
npm run cli -- probe          # live reachability check of every source
npm run cli -- probe linkedin # check one source
npm run cli -- runs           # recent runs saved in the database
npm run cli -- --help         # full help
```

---

## Usage: HTTP API

Start the server:

```bash
npm start
```

It listens on `http://localhost:3001`. You can change the port with `PORT` in `.env`.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/sources` | Sources, status and last run |
| `GET` | `/api/health/sources?probe=true` | Live reachability check |
| `POST` | `/api/jobs/search` | Run a search (JSON body, see below) |
| `POST` | `/api/jobs/search?format=csv` | Same, but download a CSV file |
| `GET` | `/api/jobs?hours=72&format=csv` | Jobs saved in the database |
| `GET` | `/api/runs` | Recent runs |
| `GET` | `/api/runs/:id` | One run with its full report |

### Search example

```bash
curl -X POST http://localhost:3001/api/jobs/search \
  -H "Content-Type: application/json" \
  -d '{"titles": ["medical billing", "medical coder"], "hoursOld": 48}'
```

Every body field is optional:

```json
{
  "titles": ["medical billing", "credentialing specialist"],
  "country": "USA",
  "remoteOnly": true,
  "hoursOld": 24,
  "sources": ["linkedin", "careerjet"],
  "maxPagesPerKeyword": 3,
  "maxResultsPerSource": 600,
  "maxResultsPerKeyword": 100,
  "includeDuplicates": false,
  "includeRejected": false,
  "includeUndated": true,
  "fetchDetails": true
}
```

Searches run one at a time. If a search is already running and the queue is full, the API returns HTTP `429`.

---

## Output

### CSV columns

Each row is one unique job. The main columns are:

| Column | Meaning |
|---|---|
| `source` / `sources` | Where the job was found (all sites, if merged) |
| `title`, `company`, `location` | Job basics |
| `remote_type` | `fully_remote` (hybrid/onsite are filtered out by default) |
| `remote_scope` | e.g. US nationwide, or restricted to certain states |
| `employment_type` | Full-time, part-time, contract… |
| `salary_raw`, `salary_min`, `salary_max`, `salary_period` | Salary as listed, plus parsed numbers |
| `matched_keyword(s)` | Which search terms the job matched |
| `posted_at`, `age_hours`, `date_confidence` | When it was posted and how sure we are |
| `description` | Plain-text job description |
| `job_url`, `apply_url` | Link to the listing / employer application |
| `ats_provider` | Workday, Greenhouse, iCIMS… when detected |
| `listing_type` | Direct employer vs staffing agency |
| `is_new`, `first_seen_at`, `reposted_at` | Compared with earlier runs |
| `duplicate_count` | How many other listings were merged into this one |

The file starts with a UTF-8 BOM so Excel opens it correctly. Cells that start with `=`, `+` or `@` are escaped to prevent formula injection.

### JSON

`--format json` returns `{ run_id, query, summary, metrics, sources, jobs }`. The `metrics` object shows how many listings were removed at each step: irrelevant, non-US, hybrid/onsite, too old, duplicates, and Indeed-routed.

### Database

Runs and jobs are saved in `data/jobs.db` (SQLite). Turn this off with `PERSIST=false` or `--no-persist`.

---

## Configuration

Every setting is optional. See [`.env.example`](.env.example) for the full list with defaults. The most useful ones:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | API port |
| `DEFAULT_HOURS_OLD` | `24` | Default posting-age window |
| `MAX_PAGES_PER_KEYWORD` | `3` | Pages per title per source |
| `FETCH_DETAILS` | `true` | Open job-detail pages |
| `INCLUDE_UNDATED` | `true` | Keep jobs with unknown posting date |
| `ENABLED_SOURCES` / `DISABLED_SOURCES` | – | Choose sources (comma-separated ids) |
| `JOOBLE_API_KEY` | – | Enables Jooble ([get a key](https://jooble.org/api/about)) |
| `CAREERJET_AFFID` | – | CareerJet affiliate id (optional) |
| `PROXY_URL` | – | Outbound HTTP proxy |
| `RUN_TIMEOUT_MS` | `900000` | Hard cap per run (partial results are returned) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

**Never commit your `.env` file.** It is already in `.gitignore`.

---

## Development

```bash
npm test           # run the test suite (offline, uses saved HTML/JSON fixtures)
npm run typecheck  # TypeScript type check
npm run dev        # API server with auto-restart on file changes
```

### Project structure

```
src/
  cli.ts                 command-line entry point
  server.ts              HTTP API entry point
  api/                   Fastify routes and request validation
  config/                environment settings and default job titles
  sources/               one adapter per job site (search + parse)
  core/
    classifier/          relevance, remote/hybrid, quality checks
    normalization/       titles, companies, salaries, dates, URLs
    dedup/               cross-site duplicate merging
    ranking/             result ordering
    pipeline/            final strict filter
  services/              search orchestration, reports, link validation
  db/                    SQLite persistence (runs, jobs, repost tracking)
  output/                CSV and JSON writers
  http/                  HTTP client with retries, rate limits, bot-block detection
tests/                   unit and integration tests
```

---

## Notes and limitations

- Results depend on what each site shows publicly at that moment. Sites change their pages over time, and a parser may need updating when they do. `npm run cli -- probe` shows which sources are healthy.
- Most results come from LinkedIn, JobRight and CareerJet. RemoteOK, Remotive and Jobicy list few medical jobs.
- JobRight matches job titles narrowly, so some titles return only a few jobs. Its descriptions are JobRight's own AI summaries (summary, responsibilities, requirements), not the original posting. The employer's apply link is shown only to logged-in users, so the `job_url` column links to the JobRight job page. Many JobRight listings are copies of LinkedIn jobs; these are merged into one row. Because JobRight hides where the application goes, the Indeed check cannot see Indeed-routed applications for JobRight listings.
- Several large job boards block automated access and are not scraped.
- LinkedIn often shows the employer's city as the location, even for remote jobs. The remote check reads the full job description, but open a few listings to confirm.
- Use this tool responsibly and respect each site's terms of service. It rate-limits itself, but don't lower the delays aggressively.
