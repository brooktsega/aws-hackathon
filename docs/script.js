const STORAGE_KEY = "hackathon-ideas";

const form = document.getElementById("idea-form");
const input = document.getElementById("idea-input");
const list = document.getElementById("idea-list");
const empty = document.getElementById("empty");
const count = document.getElementById("count");

let ideas = load();

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas));
  } catch {
    // Storage unavailable (e.g. private mode); ideas just won't persist.
  }
}

function render() {
  list.replaceChildren(
    ...ideas.map((idea) => {
      const card = document.createElement("li");
      card.className = "card";

      const text = document.createElement("div");
      text.textContent = idea.text;

      const time = document.createElement("time");
      time.dateTime = new Date(idea.createdAt).toISOString();
      time.textContent = new Date(idea.createdAt).toLocaleString();

      const del = document.createElement("button");
      del.className = "delete";
      del.type = "button";
      del.textContent = "×";
      del.setAttribute("aria-label", "Delete idea");
      del.addEventListener("click", () => {
        ideas = ideas.filter((i) => i.id !== idea.id);
        save();
        render();
      });

      card.append(text, time, del);
      return card;
    })
  );

  empty.hidden = ideas.length > 0;
  count.textContent = ideas.length ? `${ideas.length} idea${ideas.length === 1 ? "" : "s"}` : "";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  ideas.unshift({ id: crypto.randomUUID(), text, createdAt: Date.now() });
  save();
  render();
  form.reset();
  input.focus();
});

render();
