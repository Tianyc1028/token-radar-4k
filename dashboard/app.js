// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// drawer with the model's own inputs and the protocol's farm plan. No network:
// every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var watchSlugs = null;

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The radar-2 model, recomputed in the page: the page checks the number board.json
  // carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var g = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var gm = 1 + (g / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var mat = model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(age, 0) / model.maturity_scale_days));
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * gm * mat));
  }

  function mk(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category,
  // chains, TVL and age decide the action, the capital, the hold and every cost
  // and time. No protocol name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function stakeFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function coreAction(p, stake, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + stake + ' of USDC to ' + name + ' on ' + chain + ' and leave the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + stake + ' of liquidity to ' + name + "'s main pool on " + chain + ' and leave the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + stake + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds inside its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + stake + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + stake + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + stake + ' and take one position in a market on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + stake + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + stake + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + stake + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + stake + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Deposit $' + stake + ' of USDC into ' + name + ' on ' + chain + ' and leave the position open.';
  }
  function stepText(step) {
    var s = step.action + ' Cost: ' + step.cost + '. Time: ' + step.duration + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Keep the position open and check the protocol's own page.";
    return s;
  }
  function planFor(p) {
    var chain = chainOf(p);
    var stake = stakeFor(p);
    var hold = holdFor(p.age_days);
    var second = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var gas = stake >= 150 ? 8 : 4;
    return [
      { action: 'Set up a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', duration: '5 minutes' },
      { action: coreAction(p, stake, chain), cost: '$' + stake + ' of capital and about $' + gas + ' of gas', duration: '15 minutes to set up' },
      { action: 'Do one qualifying action each week: a deposit, a borrow, a swap, a vote, or a claim.', cost: 'about $2 of gas a week', duration: '10 minutes a week' },
      { action: second === null ? 'Open a second, smaller position of $25 in the same protocol so the wallet shows repeat activity.' : 'Repeat the same position on ' + second + ' with $25 so the wallet shows activity on two chains.', cost: '$25 of capital and about $3 of gas', duration: '15 minutes' },
      { action: 'Hold the main position for at least ' + hold + ' days so the activity spans more than one snapshot.', cost: 'the $' + stake + ' stays in the position', duration: hold + ' days' },
      { action: "Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', duration: '10 minutes' },
      { action: 'Write the wallet, the dates and every transaction hash in a farm log, so the position can be repeated or unwound.', cost: 'nothing but the log', duration: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function isWatch(row) {
    if (!watchSlugs) {
      watchSlugs = {};
      // The watchlist is named by the payload's board only through rank: the
      // model marks watchlist rows in data.js by their watch flag.
      DATA.rows.forEach(function (r) { if (r.watch) watchSlugs[r.slug] = true; });
    }
    return !!watchSlugs[row.slug];
  }
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.watchOnly && !isWatch(r)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return mk('header', { class: 'masthead' },
      mk('div', { class: 'brand' }, mk('span', { class: 'dot' }), mk('span', { class: 'brand-word', text: 'Token Radar' })),
      mk('div', { class: 'meta' },
        mk('span', null, 'Snapshot ', mk('b', { text: DATA.as_of })),
        mk('span', null, 'DefiLlama protocol index'),
        mk('span', null, 'Model ', mk('b', { text: DATA.model_version }))
      )
    );
  }

  function intro() {
    return mk('section', { class: 'intro' },
      mk('div', null,
        mk('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        mk('p', null,
          'The watchlist is the floor: every protocol with at least ', mk('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The early radar adds ', mk('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor. Implied value is a model, not a promise.'
        )
      ),
      mk('div', { class: 'stats' },
        mk('div', { class: 'stat' }, mk('span', { text: 'Watchlist covered' }), mk('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        mk('div', { class: 'stat' }, mk('span', { text: 'Pre-token rows scored' }), mk('b', { text: String(DATA.board_size) })),
        mk('div', { class: 'stat' }, mk('span', { text: 'Early rows below the floor' }), mk('b', { text: String(DATA.early_size) })),
        mk('div', { class: 'stat' }, mk('span', { text: 'Live-token protocols set aside' }), mk('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function topPicks() {
    var top = DATA.rows.slice(0, 3);
    return mk('section', { class: 'top3', 'aria-label': 'Top three by implied value' },
      top.map(function (r, i) {
        return mk('article', { class: 'pick' },
          mk('span', { class: 'place', text: 'Rank ' + (i + 1) }),
          mk('b', { text: r.name }),
          mk('span', { class: 'val', text: money(r.implied_value_usd) + ' implied' }),
          mk('span', { class: 'sub2', text: money(r.tvl_usd) + ' TVL · ' + (r.change_7d === null ? 'no 7d change' : pct(r.change_7d) + ' in 7d') + ' · ' + ageLabel(r.age_days) + ' with no token' })
        );
      })
    );
  }

  function toolbar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = mk('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = mk('select', { id: 'category', 'aria-label': 'Filter by category' },
      mk('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return mk('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var watch = mk('label', { class: 'check' },
      mk('input', { type: 'checkbox', checked: state.watchOnly ? 'checked' : null, 'aria-label': 'Watchlist only' }),
      'Watchlist only'
    );
    watch.querySelector('input').addEventListener('change', function (e) { state.watchOnly = e.target.checked; writeHash(); render(); });
    var sortSel = mk('select', { id: 'sort', 'aria-label': 'Sort by' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['name', 'Name']].map(function (kv) {
        return mk('option', { value: kv[0], text: kv[1], selected: state.sort === kv[0] ? 'selected' : null });
      })
    );
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
    var pre = mk('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = mk('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return mk('div', { class: 'toolbar' },
      mk('div', { class: 'field' }, mk('label', { for: 'q', text: 'Search' }), search),
      mk('div', { class: 'field' }, mk('label', { for: 'category', text: 'Category' }), select),
      mk('div', { class: 'field' }, mk('label', { for: 'sort', text: 'Sort' }), sortSel),
      watch,
      mk('div', { class: 'seg' }, pre, live),
      mk('span', { class: 'showing', text: state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortBtn(key, label) {
    return mk('th', { scope: 'col' },
      mk('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? mk('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortRows(visibleRows());
    if (list.length === 0) {
      return mk('div', { class: 'card' }, mk('div', { class: 'empty' },
        mk('h2', { text: 'No protocol matches that filter' }),
        mk('p', { text: 'Clear the search, the watchlist switch or another category to see the board again.' }),
        mk('button', { class: 'btn solid', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = mk('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var tr = mk('tr', {
        'data-open': state.selected === r.slug ? 'true' : 'false',
        class: r.rank <= 3 ? 'top-rank' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        mk('td', null, mk('span', { class: 'rank-badge', text: String(r.rank) })),
        mk('td', null, mk('div', { class: 'who' },
          mk('b', { text: r.name }),
          mk('span', { class: 'fine', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        mk('td', { class: 'num', text: money(r.tvl_usd) }),
        mk('td', { class: 'num ' + gc, text: growth }),
        mk('td', { class: 'num', text: ageLabel(r.age_days) }),
        mk('td', null, mk('div', { class: 'value-cell' },
          mk('div', { class: 'meter', 'aria-hidden': 'true' }, mk('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          mk('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        mk('td', null, mk('span', { class: 'tag' + (isWatch(r) ? ' watch' : ''), text: isWatch(r) ? 'watchlist · no token' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return mk('div', { class: 'card' },
      mk('div', { class: 'scroll' },
        mk('table', null,
          mk('caption', { class: 'fine', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          mk('thead', null, mk('tr', null,
            sortBtn('implied', 'Rank'),
            sortBtn('name', 'Protocol'),
            sortBtn('tvl', 'TVL'),
            sortBtn('growth', '7d'),
            sortBtn('age', 'Age'),
            sortBtn('implied', 'Implied value'),
            mk('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = mk('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(mk('tr', null,
        mk('td', null, mk('span', { class: 'tag live', text: 'live' })),
        mk('td', null, mk('div', { class: 'who' }, mk('b', { text: r.name }), mk('span', { class: 'fine', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        mk('td', { class: 'num', text: money(r.tvl_usd) }),
        mk('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), text: pct(r.change_7d) }),
        mk('td', { class: 'num', text: money(r.mcap_usd) }),
        mk('td', null, mk('span', { class: 'tag live', text: 'already trades' }))
      ));
    });
    return mk('div', { class: 'card' },
      mk('div', { class: 'scroll' },
        mk('table', null,
          mk('caption', { class: 'fine', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          mk('thead', null, mk('tr', null, mk('th', { scope: 'col', text: 'Status' }), mk('th', { scope: 'col', text: 'Protocol' }), mk('th', { scope: 'col', text: 'TVL' }), mk('th', { scope: 'col', text: '7d' }), mk('th', { scope: 'col', text: 'Market cap' }), mk('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function explainer() {
    var m = DATA.model;
    return mk('section', { class: 'card explainer' },
      mk('h2', { text: 'How implied value is computed' }),
      mk('p', { class: 'fine', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      mk('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x (1 - exp(-age_days / ' + m.maturity_scale_days + '))) )'
      ),
      mk('p', { class: 'fine', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Maturity saturates, so a long-lived protocol earns most of its credit for surviving and each extra year adds less. The early radar is every rankable pre-token protocol, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var drawer = mk('dialog', { class: 'drawer', id: 'detail', 'aria-labelledby': 'detail-title' });
  drawer.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    drawer.textContent = '';
    var steps = planFor(row);
    var recomputed = impliedOf(row, DATA.model);
    drawer.appendChild(mk('div', { class: 'drawer-head' },
      mk('div', null,
        mk('span', { class: 'brand-word', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        mk('h2', { id: 'detail-title', text: row.name }),
        mk('p', { class: 'fine', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      mk('button', { class: 'close-x', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { drawer.close(); } })
    ));
    drawer.appendChild(mk('section', { class: 'drawer-sec' },
      mk('h3', { text: 'Implied value' }),
      mk('div', { class: 'grid2' },
        mk('div', null, mk('span', { text: 'TVL' }), mk('b', { class: 'num', text: money(row.tvl_usd) })),
        mk('div', null, mk('span', { text: 'Seven-day growth' }), mk('b', { class: 'num', text: pct(row.change_7d) })),
        mk('div', null, mk('span', { text: 'Age with no token' }), mk('b', { class: 'num', text: ageLabel(row.age_days) })),
        mk('div', null, mk('span', { text: 'Growth multiplier' }), mk('b', { class: 'num', text: String(row.growth_multiplier) })),
        mk('div', null, mk('span', { text: 'Maturity multiplier' }), mk('b', { class: 'num', text: String(row.maturity_multiplier) })),
        mk('div', null, mk('span', { text: 'Implied value' }), mk('b', { class: 'num', text: money(row.implied_value_usd) }))
      ),
      mk('p', { class: 'fine', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    drawer.appendChild(mk('section', { class: 'drawer-sec' },
      mk('h3', { text: 'Farm plan' }),
      mk('ol', { class: 'plan' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return mk('li', null, mk('b', { text: action }), mk('span', { class: 'plan-cost', text: tail }));
      }))
    ));
    if (typeof drawer.showModal === 'function') {
      if (!drawer.open) drawer.showModal();
    } else {
      drawer.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = mk('div', { class: 'wrap' });
    shell.appendChild(masthead());
    shell.appendChild(intro());
    if (state.tab === 'pre-token') shell.appendChild(topPicks());
    shell.appendChild(toolbar());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(explainer());
    shell.appendChild(mk('p', { class: 'foot', text: 'Implied value is a model of what a token would be worth if the protocol kept its record, not a prediction that one will be issued. Farm steps are a plan, not advice.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) app.appendChild(drawer);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.open) drawer.close();
  });
})();
