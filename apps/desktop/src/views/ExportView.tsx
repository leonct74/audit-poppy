/**
 * Export — the auditor package + the licensing surface (DESIGN §2.4 + §8).
 * The license's ONLY behavioural effect is the watermark on exported
 * documents; the price is never in this code — the standard purchase button
 * reads it live from the commerce catalogue.
 */
import { useEffect, useState } from "react";
import {
  BUSINESS_PRODUCT_ID,
  EVALUATION_LINE,
  LICENSE_LINE,
  LICENSE_TIERS,
  SMALL_COMPANY_REGISTRATION_URL,
} from "@auditpoppy/core";
import { api } from "../lib/api";
import { downloadUrl, host, type PurchaseInfo } from "../lib/host";
import { Banner, friendlyError, PendingButton } from "../ui";

/** Format the LIVE price from the commerce catalogue (pricing law: the number
 *  never lives in this code — a founder price change needs nothing here). */
function formatPrice(price: NonNullable<PurchaseInfo["price"]>): string {
  const symbol = { usd: "$", eur: "€", gbp: "£" }[price.currency] ?? `${price.currency.toUpperCase()} `;
  const amount = `${symbol}${(price.amountMinor / 100).toFixed(2)}`;
  return price.kind === "subscription" ? `${amount}/${price.interval === "month" ? "month" : "year"}` : amount;
}

function BuyButton(props: { onChanged: () => void }) {
  const [info, setInfo] = useState<PurchaseInfo | null>(null);
  useEffect(() => {
    if (!host.inHost) return;
    host
      .purchaseInfo(BUSINESS_PRODUCT_ID)
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  if (!info || info.owned) return null;
  return (
    <PendingButton
      className="btn btn-primary btn-sm"
      busyLabel="Opening checkout…"
      onClick={async () => {
        const res = await host.buyProduct(BUSINESS_PRODUCT_ID);
        if (res.owned) props.onChanged();
      }}
    >
      Subscribe to remove the watermark{info.price ? ` — ${formatPrice(info.price)}` : ""}
    </PendingButton>
  );
}

function LicensePanel(props: { licensed: boolean | null; onChanged: () => void }) {
  return (
    <div className="card">
      <div className="spread">
        <h2 style={{ margin: 0 }}>License</h2>
        {props.licensed === null ? null : props.licensed ? (
          <span className="chip ok">Business license active — exports are clean</span>
        ) : (
          <span className="chip">No license yet — exports carry a watermark</span>
        )}
      </div>
      <p className="small" style={{ marginTop: 0 }}>
        <strong>{EVALUATION_LINE}</strong>
      </p>
      <p className="small muted2">{LICENSE_LINE}</p>
      <table className="tier-table">
        <thead>
          <tr>
            <th>Tier</th>
            <th>Cost</th>
            <th>Exports</th>
          </tr>
        </thead>
        <tbody>
          {LICENSE_TIERS.map((tier) => (
            <tr key={tier.id}>
              <td>
                <strong>{tier.name}</strong>
                <div className="muted small">{tier.detail}</div>
              </td>
              <td>{tier.cost}</td>
              <td>{tier.exports}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10 }}>
        <BuyButton onChanged={props.onChanged} />
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void host.openExternal(SMALL_COMPANY_REGISTRATION_URL)}
        >
          Up to 10 people? Sign up to remove the watermark
        </button>
        {props.licensed ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void host.manageSubscription(BUSINESS_PRODUCT_ID)}
          >
            Manage billing
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ExportView() {
  const [licensed, setLicensed] = useState<boolean | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<{ watermarked: boolean; generatedAt: string } | null>(null);

  const refreshLicense = (): void => {
    host
      .isPurchased(BUSINESS_PRODUCT_ID)
      .then(setLicensed)
      .catch(() => setLicensed(false));
  };
  useEffect(refreshLicense, []);
  useEffect(() => {
    api
      .notes()
      .then((r) => {
        setNotes(r.notes.join("\n"));
        setNotesLoaded(true);
      })
      .catch((err: unknown) => setError(friendlyError(err)));
  }, []);

  return (
    <>
      <LicensePanel licensed={licensed} onChanged={refreshLicense} />

      <div className="card">
        <h2>Notes for your auditor</h2>
        <p className="small muted2" style={{ marginTop: 0 }}>
          Anything your auditor should know that AWS can't show — one note per line. These appear in the
          package clearly marked as written by you.
        </p>
        <div className="field">
          <textarea
            rows={4}
            value={notes}
            disabled={!notesLoaded}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Change approvals happen in GitHub pull requests."
          />
        </div>
        <PendingButton
          className="btn btn-sm"
          busyLabel="Saving…"
          disabled={!notesLoaded}
          onClick={async () => {
            setError(null);
            try {
              await api.saveNotes(notes.split("\n").map((n) => n.trim()).filter(Boolean));
            } catch (err) {
              setError(friendlyError(err));
            }
          }}
        >
          Save notes
        </PendingButton>
      </div>

      <div className="card">
        <h2>Build the auditor package</h2>
        <p className="small muted2" style={{ marginTop: 0 }}>
          One dated package — gap status by criteria, the evidence index, the policy set, your notes — as a
          PDF your auditor reads and a JSON their tools can ingest. Generated here on your machine; the
          contents are sensitive (they describe security gaps), so share them only with people who should see
          them.
        </p>
        {licensed === false ? (
          <Banner kind="info">
            Build it now — you have full access. Every page will carry a watermark saying the document is not
            licensed for business use, so use it to judge the product; take the watermark off above before you
            hand anything to an auditor.
          </Banner>
        ) : null}
        {error ? <Banner kind="danger">{error}</Banner> : null}
        <div className="row">
          <PendingButton
            className="btn btn-primary"
            busyLabel="Building…"
            onClick={async () => {
              setError(null);
              setBuilt(null);
              try {
                const res = await api.buildExport(licensed === true);
                setBuilt({ watermarked: res.watermarked, generatedAt: res.generatedAt });
                await host.openExternal(downloadUrl(res.pdfToken));
                await host.openExternal(downloadUrl(res.jsonToken));
              } catch (err) {
                setError(friendlyError(err));
              }
            }}
          >
            Build & download (PDF + JSON)
          </PendingButton>
          {built ? (
            <span className="small muted2">
              Built {new Date(built.generatedAt).toLocaleString()}
              {built.watermarked ? " — watermarked (no license yet)" : " — clean"}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}
