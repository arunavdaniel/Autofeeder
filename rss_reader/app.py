from __future__ import annotations

import threading
import tkinter as tk
import webbrowser
from tkinter import filedialog, messagebox, simpledialog, ttk

from .database import Database
from .extractor import extract_article
from .feeds import fetch_feed


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("RSS Text Reader")
        self.geometry("1100x700")
        self.minsize(760, 500)
        self.db = Database()
        self.current_folder: int | None = None
        self.current_article: dict | None = None
        self.items: list[dict] = []
        self.refresh_job: str | None = None
        self._build_ui()
        self._load_folders()
        self.protocol("WM_DELETE_WINDOW", self._close)

    def _build_ui(self) -> None:
        toolbar = ttk.Frame(self, padding=8)
        toolbar.pack(fill="x")
        ttk.Button(toolbar, text="New Folder", command=self._new_folder).pack(
            side="left"
        )
        ttk.Button(toolbar, text="Add Feed", command=self._add_feed).pack(
            side="left", padx=(6, 0)
        )
        ttk.Button(toolbar, text="Refresh", command=self._refresh).pack(
            side="left", padx=(6, 0)
        )
        ttk.Button(toolbar, text="Save Article", command=self._save_article).pack(
            side="left", padx=(6, 0)
        )
        ttk.Button(toolbar, text="Save as TXT", command=self._export_text).pack(
            side="left", padx=(6, 0)
        )
        ttk.Button(toolbar, text="Open Link", command=self._open_link).pack(
            side="left", padx=(6, 0)
        )
        ttk.Label(toolbar, text="Auto-refresh:").pack(side="left", padx=(18, 4))
        self.refresh_interval = tk.StringVar(value="Off")
        refresh_menu = ttk.Combobox(
            toolbar,
            textvariable=self.refresh_interval,
            values=("Off", "15 minutes", "30 minutes", "1 hour", "6 hours"),
            state="readonly",
            width=12,
        )
        refresh_menu.pack(side="left")
        refresh_menu.bind("<<ComboboxSelected>>", self._refresh_setting_changed)
        self.status = ttk.Label(toolbar, text="Ready")
        self.status.pack(side="right")

        panes = ttk.PanedWindow(self, orient="horizontal")
        panes.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        left = ttk.Frame(panes, padding=6)
        center = ttk.Frame(panes, padding=6)
        right = ttk.Frame(panes, padding=6)
        panes.add(left, weight=1)
        panes.add(center, weight=2)
        panes.add(right, weight=4)

        self.folder_tree = ttk.Treeview(left, show="tree", selectmode="browse")
        self.folder_tree.pack(fill="both", expand=True)
        self.folder_tree.bind("<<TreeviewSelect>>", self._folder_selected)
        delete_buttons = ttk.Frame(left)
        delete_buttons.pack(fill="x", pady=(6, 0))
        ttk.Button(
            delete_buttons, text="Delete Folder", command=self._delete_folder
        ).pack(side="left", fill="x", expand=True)
        ttk.Button(delete_buttons, text="Delete Feed", command=self._delete_feed).pack(
            side="left", fill="x", expand=True, padx=(6, 0)
        )

        self.item_list = tk.Listbox(center, activestyle="dotbox", exportselection=False)
        self.item_list.pack(fill="both", expand=True)
        self.item_list.bind("<<ListboxSelect>>", self._item_selected)

        self.article_title = ttk.Label(
            right,
            text="Select an item",
            font=("TkDefaultFont", 14, "bold"),
            wraplength=560,
        )
        self.article_title.pack(anchor="w", pady=(0, 8))
        self.text = tk.Text(right, wrap="word", state="disabled", padx=8, pady=8)
        self.text.pack(fill="both", expand=True)

    def _load_folders(self) -> None:
        self.folder_tree.delete(*self.folder_tree.get_children())
        for folder in self.db.folders():
            node = self.folder_tree.insert(
                "", "end", iid=f"folder:{folder['id']}", text=folder["name"]
            )
            for feed in self.db.feeds(folder["id"]):
                self.folder_tree.insert(
                    node, "end", iid=f"feed:{feed['id']}", text=feed["title"]
                )

    def _selected_parts(self) -> tuple[str, int] | None:
        selection = self.folder_tree.selection()
        if not selection:
            return None
        kind, value = selection[0].split(":")
        return kind, int(value)

    def _folder_selected(self, _event=None) -> None:
        selected = self._selected_parts()
        if not selected:
            return
        kind, ident = selected
        self.current_folder = ident if kind == "folder" else self._feed_folder(ident)
        self.item_list.delete(0, "end")
        if kind == "folder":
            self.status.config(text="Folder selected. Refresh a feed to load items.")
        else:
            self.status.config(text="Feed selected. Click Refresh to load items.")
            self._refresh()
        for article in self.db.saved_articles(self.current_folder):
            self.item_list.insert("end", f"Saved: {article['title']}")

    def _feed_folder(self, feed_id: int) -> int:
        for folder in self.db.folders():
            if any(feed["id"] == feed_id for feed in self.db.feeds(folder["id"])):
                return folder["id"]
        raise ValueError("Feed folder not found")

    def _new_folder(self) -> None:
        name = simpledialog.askstring("New Folder", "Folder name:", parent=self)
        if name and name.strip():
            try:
                self.db.add_folder(name)
            except Exception as exc:
                messagebox.showerror("Cannot create folder", str(exc))
            self._load_folders()

    def _add_feed(self) -> None:
        folders = self.db.folders()
        if not folders:
            messagebox.showinfo(
                "Create a folder first", "Create a folder before adding a feed."
            )
            return
        url = simpledialog.askstring("Add Feed", "RSS or Atom feed URL:", parent=self)
        if not url:
            return
        names = ", ".join(folder["name"] for folder in folders)
        folder_name = simpledialog.askstring(
            "Feed Folder", f"Folder name ({names}):", parent=self
        )
        folder = next(
            (f for f in folders if f["name"].lower() == (folder_name or "").lower()),
            None,
        )
        if not folder:
            messagebox.showerror(
                "Unknown folder", "Enter the exact name of an existing folder."
            )
            return
        try:
            info = fetch_feed(url)
            self.db.add_feed(folder["id"], info["title"], url, info["site_url"])
            self._load_folders()
            self.status.config(text="Feed added")
        except Exception as exc:
            messagebox.showerror("Cannot add feed", str(exc))

    def _refresh(self) -> None:
        selected = self._selected_parts()
        if not selected:
            return
        kind, ident = selected
        if kind != "feed":
            self.status.config(text="Select a feed to refresh.")
            return
        feed = next(
            (f for f in self.db.feeds(self._feed_folder(ident)) if f["id"] == ident),
            None,
        )
        if not feed:
            return
        self.status.config(text="Fetching feed...")
        threading.Thread(target=self._fetch_worker, args=(feed,), daemon=True).start()

    def _refresh_setting_changed(self, _event=None) -> None:
        if self.refresh_job:
            self.after_cancel(self.refresh_job)
            self.refresh_job = None
        if self.refresh_interval.get() != "Off":
            self._schedule_refresh()
            self.status.config(text=f"Auto-refresh: {self.refresh_interval.get()}")

    def _schedule_refresh(self) -> None:
        minutes = {
            "15 minutes": 15,
            "30 minutes": 30,
            "1 hour": 60,
            "6 hours": 360,
        }.get(self.refresh_interval.get())
        if minutes:
            self.refresh_job = self.after(minutes * 60 * 1000, self._scheduled_refresh)

    def _scheduled_refresh(self) -> None:
        self.refresh_job = None
        self._refresh()
        if self.refresh_interval.get() != "Off":
            self._schedule_refresh()

    def _fetch_worker(self, feed) -> None:
        try:
            result = fetch_feed(feed["url"])
        except Exception as exc:
            self.after(0, lambda: messagebox.showerror("Refresh failed", str(exc)))
            return
        self.after(0, lambda: self._show_items(result["items"], feed["title"]))

    def _show_items(self, items: list[dict], source: str) -> None:
        self.items = [{**item, "source": source} for item in items]
        self.item_list.delete(0, "end")
        for item in self.items:
            self.item_list.insert("end", item["title"] or "Untitled")
        self.status.config(text=f"Loaded {len(items)} items")

    def _item_selected(self, _event=None) -> None:
        selection = self.item_list.curselection()
        if not selection:
            return
        index = selection[0]
        if index >= len(self.items):
            return
        self.status.config(text="Extracting article text...")
        threading.Thread(
            target=self._extract_worker, args=(self.items[index],), daemon=True
        ).start()

    def _extract_worker(self, item: dict) -> None:
        article = extract_article(item, item.get("source", ""))
        self.after(0, lambda: self._show_article(article))

    def _show_article(self, article: dict) -> None:
        self.current_article = article
        self.article_title.config(text=article["title"] or "Untitled")
        self.text.config(state="normal")
        self.text.delete("1.0", "end")
        self.text.insert("1.0", article["text"])
        self.text.config(state="disabled")
        self.status.config(text="Article ready")

    def _save_article(self) -> None:
        if self.current_folder is None or not self.current_article:
            return
        self.db.save_article(self.current_folder, self.current_article)
        self.status.config(text="Article saved")

    def _export_text(self) -> None:
        if not self.current_article:
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".txt", filetypes=[("Text files", "*.txt")]
        )
        if path:
            with open(path, "w", encoding="utf-8") as output:
                output.write(self.current_article["text"])

    def _open_link(self) -> None:
        if self.current_article and self.current_article.get("url"):
            webbrowser.open(self.current_article["url"])

    def _delete_folder(self) -> None:
        selected = self._selected_parts()
        if not selected or selected[0] != "folder":
            messagebox.showinfo(
                "Select a folder", "Select a folder before deleting it.", parent=self
            )
            return
        if not messagebox.askyesno(
            "Delete folder",
            "Delete this folder, all of its feeds, and saved articles?",
            parent=self,
        ):
            return
        self.db.delete_folder(selected[1])
        self._load_folders()
        self.item_list.delete(0, "end")

    def _delete_feed(self) -> None:
        selected = self._selected_parts()
        if not selected or selected[0] != "feed":
            messagebox.showinfo(
                "Select a feed", "Select a feed before deleting it.", parent=self
            )
            return
        if not messagebox.askyesno(
            "Delete feed", "Delete this feed? Saved articles will be kept.", parent=self
        ):
            return
        self.db.delete_feed(selected[1])
        self._load_folders()
        self.item_list.delete(0, "end")

    def _close(self) -> None:
        if self.refresh_job:
            self.after_cancel(self.refresh_job)
        self.db.close()
        self.destroy()


def main() -> None:
    App().mainloop()


if __name__ == "__main__":
    main()
