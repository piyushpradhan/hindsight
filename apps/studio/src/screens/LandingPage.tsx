import { Link } from "react-router-dom";

export function LandingPage() {
  return (
    <div className="landing">
      <section className="landing-hero" id="product">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-pulse" /> Agent replay control</div>
          <h1>Find the failure.<br />Prove the fix.</h1>
          <p>
            Hindsight turns recorded agent runs into safe, testable branches. Inspect the failure,
            change one variable, and compare the outcome without rewriting the original trace.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-light" to="/incidents">Open incident queue</Link>
            <Link className="ghost-link" to="/runs">Browse recordings <span aria-hidden="true">→</span></Link>
          </div>
          <div className="hero-footnote">
            <span>OpenTelemetry evidence</span>
            <span>SigNoz-native</span>
            <span>Side-effect safe</span>
          </div>
        </div>

        <div className="dashboard-frame" aria-label="Hindsight product preview">
          <div className="dashboard-chrome">
            <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
            <span>HINDSIGHT / CAUSAL TRACE</span>
            <span className="dashboard-live"><i /> FAILURE</span>
          </div>
          <div className="preview-run">
            <div>
              <span>INCIDENT / INC_8F3K2M01</span>
              <strong>research-agent</strong>
            </div>
            <div>
              <span>TRACE</span>
              <strong>9f1c2b7a</strong>
            </div>
            <span className="preview-status">RUN FAILED</span>
          </div>
          <div className="preview-scrubber" aria-label="Eight-step trace with a failure at step seven">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((step) => (
              <span className={step === 7 ? "failed" : ""} key={step}>{step}</span>
            ))}
          </div>
          <div className="preview-step">
            <span className="preview-step-index">#07</span>
            <div>
              <span>TOOL / WEB.SEARCH</span>
              <strong>Tool result returned malformed JSON</strong>
              <code>malformed_tool_json: unexpected end of JSON input</code>
            </div>
            <span className="preview-error">ERROR</span>
          </div>
          <div className="preview-fork">
            <span>FORK FROM STEP 07</span>
            <strong>Correct the tool result, then compare the branch.</strong>
            <span className="dashboard-action">TEST CHANGE →</span>
          </div>
          <div className="dashboard-log">
            <span>00:18:42.109</span>
            <span>8 STEPS SEALED</span>
            <span>·</span>
            <span className="log-positive">CHECKPOINT READY</span>
          </div>
        </div>
      </section>

      <section className="proof-strip" aria-label="Hindsight replay workflow">
        <span>RECORDED WITH OPENTELEMETRY</span>
        <i aria-hidden="true">/</i>
        <span>QUERIED FROM SIGNOZ</span>
        <i aria-hidden="true">/</i>
        <span>REPLAYED BY YOUR RUNNER</span>
        <i aria-hidden="true">/</i>
        <span>COMPARED BY HINDSIGHT</span>
      </section>

      <section className="landing-section" id="workflow">
        <div className="section-intro">
          <div className="eyebrow">One controlled branch</div>
          <h2>Debug the cause,<br />not the transcript.</h2>
          <p>
            Every decision stays attached to the recorded evidence. Hindsight gives your team a
            short path from alert to verified change.
          </p>
        </div>
        <div className="workflow-stack">
          <article>
            <span className="workflow-index">01 / INSPECT</span>
            <div>
              <h3>See the causal run</h3>
              <p>Requests, responses, tools, latency, tokens, and errors stay aligned by step.</p>
            </div>
            <div className="workflow-evidence">
              <span>TRACE 9F1C2B7A</span>
              <strong>8 aligned steps</strong>
            </div>
          </article>
          <article>
            <span className="workflow-index">02 / TEST</span>
            <div>
              <h3>Change one variable</h3>
              <p>Swap a model, edit the prompt, correct a tool result, or change response settings.</p>
            </div>
            <div className="workflow-evidence">
              <span>FORK INPUT</span>
              <strong>Prompt · model · tool</strong>
            </div>
          </article>
          <article>
            <span className="workflow-index">03 / VERIFY</span>
            <div>
              <h3>Compare the outcome</h3>
              <p>Review aligned steps and deltas, then keep the successful branch as proof.</p>
            </div>
            <div className="workflow-evidence positive">
              <span>VERDICT</span>
              <strong>Fix verified</strong>
            </div>
          </article>
        </div>
      </section>

      <section className="evidence-section">
        <div className="evidence-panel">
          <div className="evidence-head">
            <span>COUNTERFACTUAL / 6C21A9B</span>
            <span className="positive-text">FIX VERIFIED</span>
          </div>
          <div className="evidence-outcome">
            <div><span>ORIGINAL</span><strong>failure</strong></div>
            <span className="evidence-route" aria-hidden="true">TESTED CHANGE →</span>
            <div><span>FORK</span><strong className="positive-text">success</strong></div>
          </div>
          <div className="evidence-deltas">
            <div><span>Δ COST</span><strong>−$0.012</strong></div>
            <div><span>Δ TOKENS</span><strong>−318</strong></div>
            <div><span>Δ STEPS</span><strong>−2</strong></div>
            <div><span>Δ LATENCY</span><strong>−842ms</strong></div>
          </div>
        </div>
        <div className="evidence-copy">
          <div className="eyebrow">Proof over intuition</div>
          <h2>A fix you can defend.</h2>
          <p>
            Hindsight keeps the original run immutable and makes the branch legible. Your incident
            closes with evidence, not a guess.
          </p>
          <Link className="ghost-link" to="/incidents">Review the incident queue <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="landing-cta">
        <div>
          <div className="eyebrow"><span className="status-pulse" /> Replay is ready</div>
          <h2>Start with the failure<br />already in front of you.</h2>
        </div>
        <Link className="btn btn-dark" to="/incidents">Open Hindsight</Link>
      </section>

      <footer className="landing-footer">
        <div>
          <span className="footer-wordmark">
            <img src="/favicon.svg" alt="" />
            HINDSIGHT
          </span>
          <p>Flight recorder and replay control for AI agents.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <Link to="/incidents">Open app</Link>
          <a href="https://github.com/piyushpradhan/hindsight" target="_blank" rel="noreferrer">GitHub ↗</a>
        </nav>
      </footer>
    </div>
  );
}
