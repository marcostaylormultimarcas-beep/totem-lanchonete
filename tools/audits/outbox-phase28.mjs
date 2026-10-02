const budget=1024;

function linear(prefix, arrivals) {
  let total=prefix, cursor=0;
  const uns=new Set();
  const rows=[];
  for (let tick=0; tick<arrivals.length; tick++) {
    const add=arrivals[tick], before=total; total+=add;
    for(let r=before;r<total;r++) uns.add(r);
    let summarized=0, history=0, visits=0;
    while(visits<budget && cursor<total){
      if(uns.delete(cursor)) summarized++; else history++;
      cursor++; visits++;
    }
    if(cursor>=total) cursor=0;
    rows.push({tick:tick+1,arrivals:add,summarized,history_visits:history,backlog:uns.size,cursor});
  }
  return rows;
}

function tailFirst(prefix, arrivals) {
  let total=prefix, tail=prefix, historyCursor=0;
  const uns=new Set();
  const rows=[];
  for (let tick=0; tick<arrivals.length; tick++) {
    const add=arrivals[tick], before=total; total+=add;
    for(let r=before;r<total;r++) uns.add(r);
    const historyLimit=tail;
    let summarized=0, history=0, tailVisits=0, visits=0;
    while(tail<total && visits<budget){
      if(uns.delete(tail)) summarized++;
      tail++; tailVisits++; visits++;
    }
    if(historyCursor>=historyLimit) historyCursor=0;
    while(historyCursor<historyLimit && visits<budget){
      if(uns.delete(historyCursor)) summarized++; else history++;
      historyCursor++; visits++;
    }
    if(historyCursor>=historyLimit) historyCursor=0;
    rows.push({tick:tick+1,arrivals:add,summarized,tail_visits:tailVisits,history_visits:history,backlog:uns.size,tail_cursor:tail,history_cursor:historyCursor});
  }
  return rows;
}

const before=linear(3000,[100,100,100,100,100,100]);
const after=tailFirst(3000,[100,100,100,100,100,100]);
const overload=tailFirst(3000,[1100,1100,1100,1100,1100,1100,0]);
console.log(JSON.stringify({scenario:'before_linear_3000_prefix_100_per_tick',rows:before}));
console.log(JSON.stringify({scenario:'after_tail_first_3000_prefix_100_per_tick',rows:after}));
console.log(JSON.stringify({scenario:'after_over_capacity_1100_per_tick_then_stop',rows:overload}));

const b=before.map(x=>x.backlog);
const a=after.map(x=>x.backlog);
const o=overload.map(x=>x.backlog);
if(JSON.stringify(b)!==JSON.stringify([100,200,228,0,100,200])) throw new Error('unexpected before backlog '+JSON.stringify(b));
if(a.some(x=>x!==0)) throw new Error('tail-first should keep up: '+JSON.stringify(a));
if(JSON.stringify(o)!==JSON.stringify([76,152,228,304,380,456,0])) throw new Error('unexpected overload backlog '+JSON.stringify(o));
if(after.some(x=>x.history_visits<=0)) throw new Error('idle capacity did not revisit history');
console.log(JSON.stringify({checks:'PASS',budget,before_backlog:b,after_backlog:a,overload_backlog:o}));
