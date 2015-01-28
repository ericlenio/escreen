escreen
=======

*WARNING: this file is not up to date.*

escreen is a GNU screen wrapper, plus a set of bash shell functions that make
for consistent environment settings when ssh-ing to remote servers, and
possibly sudo-ing to other users on those servers. If you have ever spent lots
of time setting up your shell with the perfect settings for .bashrc,
.bash_profile, .vimrc, .screenrc, etc., and then found yourself mass-copying
these files to other machines you ssh to, then having to deal with changing any
of your preferences and now having to manually propagate those changes out to
those ssh sites, then this script presents a solution to avoid those types of
headaches.

There is also a handy copy/paste interface for terminal-based vim (copies to your system
clipboard), a bash function to copy files or stdin to your system clipboard,
the ability to easily upload files to a remote ssh session (yes sftp can be
used, but with escreen you can do it right in the middle of your ssh
session), and similarly download files from a ssh session.

# Requirements

* Support for running on Linux and Mac OS X (though mostly built/tested on just Linux)
* Assumes you use bash as your main shell
* escreen will launch a nodejs server when it is launched, to serve up all your preferences/settings
* So you will have to have nodejs installed (recommend 0.10.35 or later), plus the following node modules: clim, node-getopt, date-format-lite
* Depends on some basic standard Unix programs like gzip, grep, cut
* Also must have openssl installed
* Useful to have vim

# How it works

**Step 1: identify your profile.** Start by creating a **profile** (see below),
or using an existing profile. My personal profile is the only profile so far,
called `profile.lenio`.

**Step 2: set up your rcfile.** The rcfile is `$HOME/.eshrc`. This is sourced
by escreen at init time by the nodejs server. It may contain any valid
Javascript commands, but in particular you should make a unique password for
yourself like so:

    global.MY_PASSWORD = "2sCuk5iVuRXrGmmUjLfwFj8fZSsoldML";

You need not be too concerned about this password, nor is it particularly a
problem if you lose it.  Worst case is you make a new password and all cached
files will have to be re-cached (which will happen automatically).  Still, keep
the file secured: `chmod 600 $HOME/.eshrc`.

**Step 3: start escreen.** Run the following to start a new session, which
will load all your preferences, set the PS1 prompt, and create stub functions.
You can interact with the shell as per normal.

    escreen

**Step 4: use vim, ssh, screen, etc.**

If you ssh to another system, at the first shell prompt in the ssh session,
escreen will proceed to upload escreen core functions to the remote system,
plus the profile's basic settings from `bashrc`. Why not upload the entire
profile and all of your preferences at once? To save time. Because otherwise
you have to wait for everything to upload. escreen will only upload (and cache)
the minimally necessary files it needs at the moment.

## Caching

Any time escreen uploads a file to a remote server, it will cache it under
`/tmp/esh`. Each cached file is AES256 encrypted with a password derived from a
combination of your personal password (`MY_PASSWORD`) and a SHA1 hash of the
file. The next time you ssh to the same system, escreen attempts to use the
cached version first, automatically supplying the password to decrypt it on the
remote end. escreen will automatically re-upload and re-cache the file if any
of the following happen:

* the cached file is deleted
* the password supplied by escreen fails to decrypt the file for any reason

The latter is typically indicative that the original profile file was changed:
since the password depends on the hash of the file, changing the original file
immediately changes the required password on the remote end. This solves the
problem of keeping your preferences in sync on multiple systems.

Initially in your ssh session, all of the profile's bash functions are created
as stubs: calling one of them will cause escreen to first attempt to decrypt
and use a cached version of the function. If the decryption fails for any
reason, escreen just re-uploads (or uploads for the first time) a fresh copy
and re-caches it too.

# Profiles

A profile is a subdirectory off of the git checkout of escreen containing a
set of bash command files and expect files to fine-tune your bash shell. The
subdirectory naming convention is `profile.ID`, where `ID` is some identifier
to indicate who the profile was created for, or what it tries to achieve. Files
in the profile:

* *THESE ARE OUT OF DATE*
* `*.exp`: expect commands that get sourced when escreen starts up, these are usually for registering new markers and handlers (see below)
* you should have at least one .exp file that defines your PS1 marker as variable `EXPECTSSH_PS1_TAIL` (more on that variable below)
* any filename matching `^\w+` is assumed to be bash commands that usually, but not necessarily, define a bash function of the same name.
* `.bashrc`: this does what you would think for a normal .bashrc file

## Markers and handlers

Each marker is a small pattern that the main expect loop in escreen will
detect and then trigger the marker's handler.

Markers invoke handlers by using the `_ES_send_marker` bash function like so:

    local marker=$(_ES_marker SOME_LOGICAL_NAME)
    _ES_send_marker "$marker" "any paramaters here ..."

Handlers can utilize the following global variables:

* `OS`: output from `uname -s`, e.g. `Linux` or `Darwin`
* `EXPECTSSH_PROMPT`: holds the regex to detect a bash prompt
* `EXPECTSSH_PROFILE`: directory of the current profile

A handler can expect a single arg to be passed to it. The format of this data
is up to you to define: it is the 2nd arg shown above with `_ES_send_marker`.

## Vim copy/paste

The default profile **profile.lenio** includes a keyboard based copy/paste
facility for vim. This is really handy when inside GNU screen and you want to
quickly copy/paste between 2 screen windows. To use:

* go into vim's [visual mode](http://vimdoc.sourceforge.net/htmldoc/visual.html) by pressing `v`
* do vim cursor motion sequences to select the desired text
* press ctrl-C to copy (it copies to your system clipboard)
* switch to the other window (which is presumably also running vim)
* put the cursor at the position you want to paste to
* do NOT put vim into insert mode
* press ctrl-V

Since copying text actually copies to your system clipboard, you can also
ctrl-V (command-V if on Mac) the text you selected from vim into some other
application.

## Other core bash functions

The following core bash functions are system level and are therefore usable under any profile.

* *THESE ARE OUT OF DATE*
* `cp2cb`: takes 1 argument: the name of a file to be copied to the system clipboard of your Linux PC (or Mac). Or if no file is supplied, it reads from stdin.
