// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Register sqlite-vec globally for ALL SQLite connections opened by this process.
// Must happen before app_lib::run() so that tauri-plugin-sql connections inherit it.
// SAFETY: sqlite3_auto_extension expects a valid sqlite3 extension init function.
// sqlite3_vec_init is the canonical entry point from the sqlite-vec crate.
#[cfg(not(target_os = "android"))]
fn register_sqlite_vec() {
    unsafe {
        let init_ptr = sqlite_vec::sqlite3_vec_init as *const ();
        #[allow(clippy::missing_transmute_annotations)]
        libsqlite3_sys::sqlite3_auto_extension(Some(std::mem::transmute(init_ptr)));
    }
}

fn main() {
    #[cfg(not(target_os = "android"))]
    register_sqlite_vec();

    app_lib::run();
}
