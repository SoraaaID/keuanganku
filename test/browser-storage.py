"""Exercise migration and stale writes against Chrome's real IndexedDB."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait


def check_storage(driver, url):
    driver.get(url)
    driver.execute_script("""
        localStorage.setItem(STORAGE_KEY, JSON.stringify([{
          id: 'legacy', type: 'expense', title: 'Legacy', date: '2026-11-01',
          amount: 1000, category: 'food', time: '12:00', notes: ''
        }]));
        localStorage.setItem(BUDGET_KEY, JSON.stringify({food: 5000}));
    """)
    driver.refresh()
    assert driver.execute_script("return state.transactions[0].id") == "legacy"
    assert driver.execute_script("return state.budgets.food") == 5000

    original_tab = driver.current_window_handle
    driver.switch_to.new_window("tab")
    driver.get(url)
    second_tab = driver.current_window_handle
    old_revision = driver.execute_script("return state.revision")

    driver.switch_to.window(original_tab)
    assert driver.execute_async_script("""
        const finish = arguments[0];
        const saved = { ...state.transactions[0], id: 'new', title: 'New' };
        saveTransactions([...state.transactions, saved]).then(() => finish(true),
          error => finish(error.message));
    """) is True

    driver.switch_to.window(second_tab)
    outcome = driver.execute_async_script("""
        const [revision, finish] = arguments;
        saveTransactions([], revision).then(() => finish('unexpected success'),
          error => finish(error.message));
    """, old_revision)
    assert outcome.startswith("Data berubah"), outcome
    WebDriverWait(driver, 5).until(
        lambda browser: browser.execute_script("return state.transactions.length") == 2
    )
    driver.refresh()
    WebDriverWait(driver, 5).until(
        lambda browser: browser.execute_script("return state.revision") == 1
    )
    assert driver.execute_script("return state.transactions.map(item => item.id)") == [
        "legacy", "new"
    ]
    assert driver.execute_script("return state.budgets.food") == 5000


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--disable-dev-shm-usage")
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with webdriver.Chrome(options=options) as driver:
                check_storage(driver, f"http://127.0.0.1:{server.server_port}/")
        finally:
            server.shutdown()
